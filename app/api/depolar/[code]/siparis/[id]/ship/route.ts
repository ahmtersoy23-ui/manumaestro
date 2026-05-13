/**
 * POST /api/depolar/[code]/siparis/[id]/ship
 * DRAFT → SHIPPED transition.
 * Tek transaction: rezerve düşer, gerçek quantity azalır,
 * her kalem için ShelfMovement(OUTBOUND) log atılır.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import {
  lockShelfBoxById,
  lockShelfStockByPair,
  assertNonNegative,
} from '@/lib/wms/lockedStock';
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

    try {
      const result = await prisma.$transaction(async (tx) => {
        const order = await tx.outboundOrder.findUnique({
          where: { id },
          include: { items: true },
        });
        if (!order || order.warehouseCode !== upperCode) throw new Error('Sipariş bulunamadı');
        if (order.status !== 'DRAFT') throw new Error('Sadece DRAFT siparişler gönderilir');
        if (order.items.length === 0) throw new Error('Sipariş kalemi yok');

        const refType = order.orderType === 'FBA_PICKUP' ? 'FBA_PICKUP' : 'OUTBOUND_ORDER';

        for (const item of order.items) {
          if (item.shelfBoxId) {
            // Koliden çıkış (FOR UPDATE lock)
            const box = await lockShelfBoxById(tx, item.shelfBoxId);
            if (!box) throw new Error(`Koli artık yok: ${item.shelfBoxId}`);
            const newQty = box.quantity - item.quantity;
            const newReserved = box.reservedQty - item.quantity;
            assertNonNegative(`Koli ${box.boxNumber} quantity`, newQty);
            assertNonNegative(`Koli ${box.boxNumber} rezerve`, newReserved);
            const newStatus = newQty === 0 ? 'EMPTY' : 'PARTIAL';
            await tx.shelfBox.update({
              where: { id: box.id },
              data: { quantity: newQty, reservedQty: newReserved, status: newStatus },
            });
            await tx.shelfMovement.create({
              data: {
                warehouseCode: upperCode,
                type: 'OUTBOUND',
                fromShelfId: box.shelfId,
                iwasku: item.iwasku,
                quantity: item.quantity,
                shelfBoxId: box.id,
                refType,
                refId: order.id,
                userId: auth.user.id,
                notes: `Sipariş ${order.orderNumber}: koli ${box.boxNumber} (${item.quantity})`,
              },
            });
          } else if (item.shelfId) {
            // ShelfStock'tan çıkış (FOR UPDATE lock)
            const stock = await lockShelfStockByPair(tx, item.shelfId, item.iwasku);
            if (!stock) throw new Error(`Raf stoğu artık yok: ${item.iwasku}`);
            const newQty = stock.quantity - item.quantity;
            const newReserved = stock.reservedQty - item.quantity;
            assertNonNegative(`Raf stoğu ${item.iwasku} quantity`, newQty);
            assertNonNegative(`Raf stoğu ${item.iwasku} rezerve`, newReserved);
            if (newQty === 0) {
              await tx.shelfStock.delete({ where: { id: stock.id } });
            } else {
              await tx.shelfStock.update({
                where: { id: stock.id },
                data: { quantity: newQty, reservedQty: newReserved },
              });
            }
            await tx.shelfMovement.create({
              data: {
                warehouseCode: upperCode,
                type: 'OUTBOUND',
                fromShelfId: item.shelfId,
                iwasku: item.iwasku,
                quantity: item.quantity,
                refType,
                refId: order.id,
                userId: auth.user.id,
                notes: `Sipariş ${order.orderNumber}: ${item.iwasku} (${item.quantity})`,
              },
            });
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
