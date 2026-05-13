/**
 * POST /api/depolar/[code]/siparis/[id]/revert
 * SHIPPED siparişin sevkiyatını geri al — stoğu geri yükler, allocation'ları
 * siler, ShelfMovement(REVERSAL) kayıtları yaratır, status DRAFT'a döner.
 *
 * Sadece admin/super-admin (managePermissions yetkisi). Test/hata düzeltme
 * amaçlı; gerçek müşteri sevkiyatları için iade akışı ayrı kurgulanmalı.
 *
 * SINGLE: OutboundOrderItemAllocation rows üzerinden geri yükle.
 * FBA_PICKUP: legacy items.shelfBoxId üzerinden geri yükle.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const POST = withRoute<{ code: string; id: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Geri alınamadı' },
  async ({ request, params }) => {
    const { code, id } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }
    // Geri alma kritik aksiyon — managePermissions admin/super-admin'e ait
    const auth = await requireShelfAction(request, upperCode, 'managePermissions');
    if (auth instanceof NextResponse) return auth;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const order = await tx.outboundOrder.findUnique({
          where: { id },
          include: {
            items: { include: { allocations: true } },
          },
        });
        if (!order || order.warehouseCode !== upperCode) throw new Error('Sipariş bulunamadı');
        if (order.status !== 'SHIPPED') throw new Error('Sadece SHIPPED siparişler geri alınabilir');

        // Bu sipariş için OUTBOUND hareketleri (REVERSAL'a referans için)
        const outboundMovements = await tx.shelfMovement.findMany({
          where: {
            warehouseCode: upperCode,
            type: 'OUTBOUND',
            refType: order.orderType === 'FBA_PICKUP' ? 'FBA_PICKUP' : 'OUTBOUND_ORDER',
            refId: order.id,
          },
        });
        const movementByKey = new Map<string, typeof outboundMovements[number]>();
        for (const m of outboundMovements) {
          // Anahtar: iwasku|qty|shelfBoxId(or '')|fromShelfId(or '')
          const k = `${m.iwasku}|${m.quantity}|${m.shelfBoxId ?? ''}|${m.fromShelfId ?? ''}`;
          movementByKey.set(k, m);
        }

        // SINGLE: allocations üzerinden geri yükle
        // FBA_PICKUP: items.shelfBoxId üzerinden geri yükle (legacy path)
        if (order.orderType === 'SINGLE') {
          for (const item of order.items) {
            if (item.allocations.length === 0) {
              // Allocation yoksa legacy ship endpoint kullanmış olabilir — fallback:
              // items.shelfId / items.shelfBoxId üzerinden tek pick olarak geri yükle.
              await revertLegacyItem(tx, upperCode, order, item, auth.user.id, movementByKey);
              continue;
            }
            for (const alloc of item.allocations) {
              await revertAllocation(tx, upperCode, order, item, alloc, auth.user.id, movementByKey);
            }
            // Allocation'ları sil — yeniden çıkış için
            await tx.outboundOrderItemAllocation.deleteMany({
              where: { orderItemId: item.id },
            });
          }
        } else {
          // FBA_PICKUP legacy
          for (const item of order.items) {
            await revertLegacyItem(tx, upperCode, order, item, auth.user.id, movementByKey);
          }
        }

        const updated = await tx.outboundOrder.update({
          where: { id: order.id },
          data: {
            status: 'DRAFT',
            shippedById: null,
            shippedAt: null,
          },
        });
        return updated;
      });

      return successResponse(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Geri alınamadı';
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }
  }
);

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function revertAllocation(
  tx: Tx,
  warehouseCode: string,
  order: { id: string; orderNumber: string; orderType: string },
  item: { id: string; iwasku: string },
  alloc: { id: string; shelfId: string | null; shelfBoxId: string | null; quantity: number },
  userId: string,
  movementByKey: Map<string, { id: string; iwasku: string | null; quantity: number | null; shelfBoxId: string | null; fromShelfId: string | null }>
) {
  // Yeni davranış: BOX pick → koli açılır + tekil rafa aktarılır + oradan çıkış.
  // Bu durumda allocation'da shelfId DOLU (tekil çıkış kaynağı), shelfBoxId
  // sadece origin audit için tutuluyor. shelfId öncelikli kontrol et.
  if (alloc.shelfId) {
    // Tekil rafa geri ekle
    const stock = await tx.shelfStock.findUnique({
      where: { shelfId_iwasku: { shelfId: alloc.shelfId, iwasku: item.iwasku } },
    });
    if (stock) {
      await tx.shelfStock.update({
        where: { id: stock.id },
        data: { quantity: stock.quantity + alloc.quantity },
      });
    } else {
      await tx.shelfStock.create({
        data: {
          warehouseCode,
          shelfId: alloc.shelfId,
          iwasku: item.iwasku,
          quantity: alloc.quantity,
          reservedQty: 0,
        },
      });
    }
    const key = `${item.iwasku}|${alloc.quantity}||${alloc.shelfId}`;
    const orig = movementByKey.get(key);
    await tx.shelfMovement.create({
      data: {
        warehouseCode,
        type: 'REVERSAL',
        toShelfId: alloc.shelfId,
        iwasku: item.iwasku,
        quantity: alloc.quantity,
        refType: 'OUTBOUND_REVERT',
        refId: order.id,
        userId,
        notes: `Sevk geri alındı: sipariş ${order.orderNumber}, ${item.iwasku} (${alloc.quantity})`,
        ...(orig ? { reverseOfId: orig.id } : {}),
      },
    });
    return;
  }
  // Sadece shelfBoxId set ise: legacy box-bazlı pick (eski ship-allocate / FBA ship)
  if (alloc.shelfBoxId) {
    const box = await tx.shelfBox.findUnique({ where: { id: alloc.shelfBoxId } });
    if (!box) throw new Error(`Koli bulunamadı (geri alma): ${alloc.shelfBoxId}`);
    const newQty = box.quantity + alloc.quantity;
    const newStatus: 'SEALED' | 'PARTIAL' | 'EMPTY' =
      box.status === 'EMPTY' ? 'PARTIAL' : (box.status as 'SEALED' | 'PARTIAL');
    await tx.shelfBox.update({
      where: { id: box.id },
      data: { quantity: newQty, status: newStatus },
    });
    const key = `${item.iwasku}|${alloc.quantity}|${box.id}|${box.shelfId}`;
    const orig = movementByKey.get(key);
    await tx.shelfMovement.create({
      data: {
        warehouseCode,
        type: 'REVERSAL',
        toShelfId: box.shelfId,
        iwasku: item.iwasku,
        quantity: alloc.quantity,
        shelfBoxId: box.id,
        refType: 'OUTBOUND_REVERT',
        refId: order.id,
        userId,
        notes: `Sevk geri alındı: sipariş ${order.orderNumber}, koli ${box.boxNumber} (${alloc.quantity})`,
        ...(orig ? { reverseOfId: orig.id } : {}),
      },
    });
  }
}

async function revertLegacyItem(
  tx: Tx,
  warehouseCode: string,
  order: { id: string; orderNumber: string; orderType: string },
  item: { id: string; iwasku: string; quantity: number; shelfId: string | null; shelfBoxId: string | null },
  userId: string,
  movementByKey: Map<string, { id: string; iwasku: string | null; quantity: number | null; shelfBoxId: string | null; fromShelfId: string | null }>
) {
  if (item.shelfBoxId) {
    const box = await tx.shelfBox.findUnique({ where: { id: item.shelfBoxId } });
    if (!box) throw new Error(`Koli bulunamadı (legacy): ${item.shelfBoxId}`);
    const newQty = box.quantity + item.quantity;
    const newStatus: 'SEALED' | 'PARTIAL' | 'EMPTY' =
      box.status === 'EMPTY' ? 'PARTIAL' : box.status as 'SEALED' | 'PARTIAL';
    await tx.shelfBox.update({
      where: { id: box.id },
      data: { quantity: newQty, status: newStatus },
    });
    const key = `${item.iwasku}|${item.quantity}|${box.id}|${box.shelfId}`;
    const orig = movementByKey.get(key);
    await tx.shelfMovement.create({
      data: {
        warehouseCode,
        type: 'REVERSAL',
        toShelfId: box.shelfId,
        iwasku: item.iwasku,
        quantity: item.quantity,
        shelfBoxId: box.id,
        refType: 'OUTBOUND_REVERT',
        refId: order.id,
        userId,
        notes: `Sevk geri alındı (legacy): sipariş ${order.orderNumber}, koli ${box.boxNumber} (${item.quantity})`,
        ...(orig ? { reverseOfId: orig.id } : {}),
      },
    });
  } else if (item.shelfId) {
    const stock = await tx.shelfStock.findUnique({
      where: { shelfId_iwasku: { shelfId: item.shelfId, iwasku: item.iwasku } },
    });
    if (stock) {
      await tx.shelfStock.update({
        where: { id: stock.id },
        data: { quantity: stock.quantity + item.quantity },
      });
    } else {
      await tx.shelfStock.create({
        data: {
          warehouseCode,
          shelfId: item.shelfId,
          iwasku: item.iwasku,
          quantity: item.quantity,
          reservedQty: 0,
        },
      });
    }
    const key = `${item.iwasku}|${item.quantity}||${item.shelfId}`;
    const orig = movementByKey.get(key);
    await tx.shelfMovement.create({
      data: {
        warehouseCode,
        type: 'REVERSAL',
        toShelfId: item.shelfId,
        iwasku: item.iwasku,
        quantity: item.quantity,
        refType: 'OUTBOUND_REVERT',
        refId: order.id,
        userId,
        notes: `Sevk geri alındı (legacy): sipariş ${order.orderNumber}, ${item.iwasku} (${item.quantity})`,
        ...(orig ? { reverseOfId: orig.id } : {}),
      },
    });
  }
}
