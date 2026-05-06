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

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import {
  lockShelfBoxById,
  lockShelfStockById,
  assertNonNegative,
} from '@/lib/wms/lockedStock';

const PickSchema = z
  .object({
    source: z.enum(['STOCK', 'BOX']),
    shelfId: z.string().trim().optional(),
    shelfStockId: z.string().trim().optional(),
    shelfBoxId: z.string().trim().optional(),
    qty: z.number().int().positive().max(100000),
  })
  .refine(
    (p) =>
      (p.source === 'STOCK' && !!p.shelfStockId && !!p.shelfId) ||
      (p.source === 'BOX' && !!p.shelfBoxId),
    { message: 'STOCK için shelfStockId+shelfId, BOX için shelfBoxId zorunlu' }
  );

const AllocationSchema = z.object({
  itemId: z.string().trim().min(1),
  picks: z.array(PickSchema).min(1).max(20),
});

const ShipAllocateSchema = z.object({
  allocations: z.array(AllocationSchema).min(1).max(50),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id } = await context.params;
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

      // 1) Her allocation için item geçerli mi + sum(qty) == item.quantity
      for (const a of allocations) {
        const item = itemMap.get(a.itemId);
        if (!item) throw new Error(`Sipariş kalemi bulunamadı: ${a.itemId}`);
        const sum = a.picks.reduce((s, p) => s + p.qty, 0);
        if (sum !== item.quantity) {
          throw new Error(
            `${item.iwasku}: ${item.quantity} adet bekleniyor, ${sum} adet seçilmiş`
          );
        }
      }

      // Her sipariş kaleminin allocation'ı verilmeli
      const allocatedItemIds = new Set(allocations.map((a) => a.itemId));
      for (const item of order.items) {
        if (!allocatedItemIds.has(item.id)) {
          throw new Error(`${item.iwasku}: raf seçimi eksik`);
        }
      }

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
            // BOX
            const box = await lockShelfBoxById(tx, p.shelfBoxId!);
            if (!box) throw new Error(`Koli bulunamadı: ${p.shelfBoxId}`);
            if (box.iwasku !== item.iwasku) {
              throw new Error(
                `Koli iwasku uyumsuz: beklenen ${item.iwasku}, bulunan ${box.iwasku}`
              );
            }
            const newQty = box.quantity - p.qty;
            assertNonNegative(`Koli ${box.boxNumber} quantity`, newQty);
            const newReserved = Math.max(0, box.reservedQty);
            const newStatus: 'SEALED' | 'PARTIAL' | 'EMPTY' =
              newQty === 0 ? 'EMPTY' : 'PARTIAL';
            await tx.shelfBox.update({
              where: { id: box.id },
              data: { quantity: newQty, reservedQty: newReserved, status: newStatus },
            });
            await tx.outboundOrderItemAllocation.create({
              data: {
                orderItemId: item.id,
                shelfId: null,
                shelfBoxId: box.id,
                quantity: p.qty,
              },
            });
            await tx.shelfMovement.create({
              data: {
                warehouseCode: upperCode,
                type: 'OUTBOUND',
                fromShelfId: box.shelfId,
                iwasku: item.iwasku,
                quantity: p.qty,
                shelfBoxId: box.id,
                refType,
                refId: order.id,
                userId: auth.user.id,
                notes: `Sipariş ${order.orderNumber}: koli ${box.boxNumber} (${p.qty})`,
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

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sipariş gönderilemedi';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
