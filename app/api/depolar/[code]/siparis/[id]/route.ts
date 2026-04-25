/**
 * GET /api/depolar/[code]/siparis/[id]
 * Sipariş detayı + kalemler + ürün adları (products lookup).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getProductsByIwasku } from '@/lib/products/lookup';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'view');
  if (auth instanceof NextResponse) return auth;

  const order = await prisma.outboundOrder.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order || order.warehouseCode !== upperCode) {
    return NextResponse.json({ success: false, error: 'Sipariş bulunamadı' }, { status: 404 });
  }

  // Kalemlerin raf/koli detaylarını topla
  const shelfIds = order.items.map((i) => i.shelfId).filter(Boolean) as string[];
  const boxIds = order.items.map((i) => i.shelfBoxId).filter(Boolean) as string[];

  const [shelves, boxes] = await Promise.all([
    shelfIds.length > 0
      ? prisma.shelf.findMany({ where: { id: { in: shelfIds } }, select: { id: true, code: true } })
      : Promise.resolve([]),
    boxIds.length > 0
      ? prisma.shelfBox.findMany({
          where: { id: { in: boxIds } },
          select: { id: true, boxNumber: true, shelfId: true, status: true, quantity: true, reservedQty: true },
        })
      : Promise.resolve([]),
  ]);

  const shelfMap = new Map(shelves.map((s) => [s.id, s]));
  const boxMap = new Map(boxes.map((b) => [b.id, b]));

  // Box'ların shelf code'u için ek lookup
  const boxShelfIds = boxes.map((b) => b.shelfId);
  const boxShelves =
    boxShelfIds.length > 0
      ? await prisma.shelf.findMany({ where: { id: { in: boxShelfIds } }, select: { id: true, code: true } })
      : [];
  const boxShelfMap = new Map(boxShelves.map((s) => [s.id, s.code]));

  // Product names
  const productMap = await getProductsByIwasku(order.items.map((i) => i.iwasku));

  return NextResponse.json({
    success: true,
    data: {
      role: auth.shelfRole,
      order: {
        id: order.id,
        orderType: order.orderType,
        marketplaceCode: order.marketplaceCode,
        orderNumber: order.orderNumber,
        description: order.description,
        status: order.status,
        createdAt: order.createdAt,
        shippedAt: order.shippedAt,
      },
      items: order.items.map((item) => {
        const box = item.shelfBoxId ? boxMap.get(item.shelfBoxId) : null;
        return {
          id: item.id,
          iwasku: item.iwasku,
          productName: productMap.get(item.iwasku)?.name ?? null,
          quantity: item.quantity,
          shelfId: item.shelfId,
          shelfCode: item.shelfId ? shelfMap.get(item.shelfId)?.code ?? null : box ? boxShelfMap.get(box.shelfId) ?? null : null,
          shelfBoxId: item.shelfBoxId,
          boxNumber: box?.boxNumber ?? null,
          boxStatus: box?.status ?? null,
        };
      }),
    },
  });
}
