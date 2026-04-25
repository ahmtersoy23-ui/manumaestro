/**
 * POST /api/depolar/[code]/siparis/[id]/cancel
 * DRAFT → CANCELLED. Tüm rezerveler serbest bırakılır, kalemler korunur (audit).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }
  const auth = await requireShelfAction(request, upperCode, 'cancelOutbound');
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!order || order.warehouseCode !== upperCode) throw new Error('Sipariş bulunamadı');
      if (order.status !== 'DRAFT') throw new Error('Sadece DRAFT siparişler iptal edilir');

      // Rezerveleri geri al
      for (const item of order.items) {
        if (item.shelfBoxId) {
          await tx.shelfBox.update({
            where: { id: item.shelfBoxId },
            data: { reservedQty: { decrement: item.quantity } },
          });
        } else if (item.shelfId) {
          const stock = await tx.shelfStock.findUnique({
            where: { shelfId_iwasku: { shelfId: item.shelfId, iwasku: item.iwasku } },
          });
          if (stock) {
            await tx.shelfStock.update({
              where: { id: stock.id },
              data: { reservedQty: { decrement: item.quantity } },
            });
          }
        }
      }

      return tx.outboundOrder.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'İptal başarısız';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
