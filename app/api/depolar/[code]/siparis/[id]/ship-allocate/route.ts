/**
 * POST /api/depolar/[code]/siparis/[id]/ship-allocate
 * Allocation tabanlı SHIPPED transition (yeni SINGLE akış için).
 *
 * Input:
 *   {
 *     allocations: [{
 *       itemId: string,
 *       picks: [{
 *         source: 'STOCK' | 'BOX',
 *         shelfId?:    string,  // STOCK için zorunlu (raf id)
 *         shelfStockId?: string, // STOCK için zorunlu (loose stock satır id)
 *         shelfBoxId?: string,  // BOX için zorunlu
 *         qty: number,
 *       }]
 *     }]
 *   }
 *
 * Validasyon:
 *   - Her item için sum(picks.qty) == item.quantity
 *   - Her pick için available >= qty (FOR UPDATE lock altında)
 *
 * Tek transaction'da:
 *   - ShelfStock / ShelfBox decrement (FOR UPDATE)
 *   - OutboundOrderItemAllocation rows yarat
 *   - ShelfMovement(OUTBOUND) her pick için
 *   - OutboundOrder status=SHIPPED + shippedAt + shippedById
 *
 * FBA_PICKUP için /ship endpoint'i kullanılır (legacy box-bazlı path).
 * Bu endpoint sadece SINGLE'ı destekler — istek başkası ise 400.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import {
  lockShelfBoxById,
  lockShelfStockById,
  assertNonNegative,
} from '@/lib/wms/lockedStock';
import {
  ShipAllocateSchema,
  validateAllocationsCoverage,
} from '@/lib/wms/shipAllocateSchemas';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const POST = withRoute<{ code: string; id: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Sipariş gönderilemedi' },
  async ({ request, params }) => {
    const { code, id } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }
    const auth = await requireShelfAction(request, upperCode, 'shipOutbound');
    if (auth instanceof NextResponse) return auth;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
    }
    const parsed = ShipAllocateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { allocations } = parsed.data;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const order = await tx.outboundOrder.findUnique({
          where: { id },
          include: { items: true },
        });
        if (!order || order.warehouseCode !== upperCode) throw new Error('Sipariş bulunamadı');
        if (order.status !== 'DRAFT') throw new Error('Sadece DRAFT siparişler gönderilir');
        if (order.items.length === 0) throw new Error('Sipariş kalemi yok');
        if (order.orderType !== 'SINGLE')
          throw new Error('ship-allocate yalnız SINGLE siparişler için');

        const itemMap = new Map(order.items.map((i) => [i.id, i]));

        // 1) Allocation kapsam + miktar doğrulaması (pure helper, tests'de cover ediliyor)
        const coverageErr = validateAllocationsCoverage(allocations, order.items);
        if (coverageErr) throw new Error(coverageErr);

        const refType = 'OUTBOUND_ORDER';

        // 2) Her pick için lock + decrement + Allocation yarat + Movement log
        for (const a of allocations) {
          const item = itemMap.get(a.itemId)!;
          for (const p of a.picks) {
            if (p.source === 'STOCK') {
              const stock = await lockShelfStockById(tx, p.shelfStockId!);
              if (!stock) throw new Error(`Raf stoğu bulunamadı: ${p.shelfStockId}`);
              if (stock.iwasku !== item.iwasku) {
                throw new Error(
                  `Raf stoğu iwasku uyumsuz: beklenen ${item.iwasku}, bulunan ${stock.iwasku}`
                );
              }
              const newQty = stock.quantity - p.qty;
              assertNonNegative(`Raf stoğu ${item.iwasku} quantity`, newQty);
              // reservedQty bu akışta zaten 0 (allocation girişte yapılmıyor) — defansif
              const newReserved = Math.max(0, stock.reservedQty);
              if (newQty === 0) {
                await tx.shelfStock.delete({ where: { id: stock.id } });
              } else {
                await tx.shelfStock.update({
                  where: { id: stock.id },
                  data: { quantity: newQty, reservedQty: newReserved },
                });
              }
              await tx.outboundOrderItemAllocation.create({
                data: {
                  orderItemId: item.id,
                  shelfId: p.shelfId,
                  shelfBoxId: null,
                  quantity: p.qty,
                },
              });
              await tx.shelfMovement.create({
                data: {
                  warehouseCode: upperCode,
                  type: 'OUTBOUND',
                  fromShelfId: stock.shelfId,
                  iwasku: item.iwasku,
                  quantity: p.qty,
                  refType,
                  refId: order.id,
                  userId: auth.user.id,
                  notes: `Sipariş ${order.orderNumber}: ${item.iwasku} (${p.qty})`,
                },
              });
            } else {
              // BOX pick → SINGLE'da koli OTOMATİK AÇILIR:
              //   1) Kutudaki tüm adet (totalInBox) tekil ShelfStock'a aktarılır
              //   2) Kutu EMPTY hale gelir (quantity=0)
              //   3) ShelfMovement(BOX_OPEN) audit log
              //   4) Sonra tekil rafdan pick.qty kadar OUTBOUND (ShelfStock decrement)
              //   5) Allocation kaydında hem shelfId hem shelfBoxId tutulur (audit izi)
              const box = await lockShelfBoxById(tx, p.shelfBoxId!);
              if (!box) throw new Error(`Koli bulunamadı: ${p.shelfBoxId}`);
              if (box.iwasku !== item.iwasku) {
                throw new Error(
                  `Koli iwasku uyumsuz: beklenen ${item.iwasku}, bulunan ${box.iwasku}`
                );
              }
              const totalInBox = box.quantity;
              assertNonNegative(`Koli ${box.boxNumber} pick`, totalInBox - p.qty);

              // 1) Kutuyu boşalt
              await tx.shelfBox.update({
                where: { id: box.id },
                data: { quantity: 0, reservedQty: 0, status: 'EMPTY' },
              });
              // 2) Audit: BOX_OPEN
              await tx.shelfMovement.create({
                data: {
                  warehouseCode: upperCode,
                  type: 'BOX_OPEN',
                  toShelfId: box.shelfId,
                  iwasku: item.iwasku,
                  quantity: totalInBox,
                  shelfBoxId: box.id,
                  refType: 'OUTBOUND_PICK_OPEN',
                  refId: order.id,
                  userId: auth.user.id,
                  notes: `Sipariş ${order.orderNumber}: koli ${box.boxNumber} açıldı (${totalInBox} adet rafa)`,
                },
              });
              // 3) Tekil rafa kalan + alınan kadar yaz (toplam = totalInBox)
              //    Sonra pick.qty düşülür → net etki: rafta (totalInBox - p.qty), pick gitti.
              const stock = await tx.shelfStock.upsert({
                where: { shelfId_iwasku: { shelfId: box.shelfId, iwasku: item.iwasku } },
                create: {
                  warehouseCode: upperCode,
                  shelfId: box.shelfId,
                  iwasku: item.iwasku,
                  quantity: totalInBox,
                  reservedQty: 0,
                },
                update: { quantity: { increment: totalInBox } },
              });
              // 4) Tekil rafdan pick.qty düş
              const newStockQty = stock.quantity - p.qty;
              assertNonNegative(`Raf stoğu ${item.iwasku} pick`, newStockQty);
              if (newStockQty === 0) {
                await tx.shelfStock.delete({ where: { id: stock.id } });
              } else {
                await tx.shelfStock.update({
                  where: { id: stock.id },
                  data: { quantity: newStockQty },
                });
              }
              // 5) Allocation: hem shelfId (asıl çıkış kaynağı) hem shelfBoxId (origin audit)
              await tx.outboundOrderItemAllocation.create({
                data: {
                  orderItemId: item.id,
                  shelfId: box.shelfId,
                  shelfBoxId: box.id,
                  quantity: p.qty,
                },
              });
              // 6) OUTBOUND audit
              await tx.shelfMovement.create({
                data: {
                  warehouseCode: upperCode,
                  type: 'OUTBOUND',
                  fromShelfId: box.shelfId,
                  iwasku: item.iwasku,
                  quantity: p.qty,
                  refType,
                  refId: order.id,
                  userId: auth.user.id,
                  notes: `Sipariş ${order.orderNumber}: ${item.iwasku} (${p.qty}, koli ${box.boxNumber} açıldı)`,
                },
              });
            }
          }
        }

        const updated = await tx.outboundOrder.update({
          where: { id: order.id },
          data: {
            status: 'SHIPPED',
            shippedById: auth.user.id,
            shippedAt: new Date(),
          },
        });

        return updated;
      });

      return successResponse(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sipariş gönderilemedi';
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }
  }
);
