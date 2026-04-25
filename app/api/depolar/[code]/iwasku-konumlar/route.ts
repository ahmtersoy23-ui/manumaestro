/**
 * GET /api/depolar/[code]/iwasku-konumlar?iwasku=X
 * Bir iwasku'nun bu depodaki tüm raf+koli konumlarını döner.
 * Sipariş kalem eklerken kullanıcının kaynağı seçmesi için.
 *
 * Sadece available > 0 (quantity - reservedQty) olanları gösterir.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getProductsByIwasku } from '@/lib/products/lookup';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'view');
  if (auth instanceof NextResponse) return auth;

  const iwasku = new URL(request.url).searchParams.get('iwasku')?.trim();
  if (!iwasku) {
    return NextResponse.json({ success: false, error: 'iwasku gerekli' }, { status: 400 });
  }

  const [stocks, boxes] = await Promise.all([
    prisma.shelfStock.findMany({
      where: { warehouseCode: upperCode, iwasku },
      include: { shelf: { select: { code: true, shelfType: true } } },
    }),
    prisma.shelfBox.findMany({
      where: { warehouseCode: upperCode, iwasku, status: { not: 'EMPTY' } },
      include: { shelf: { select: { code: true, shelfType: true } } },
    }),
  ]);

  const productMap = await getProductsByIwasku([iwasku]);
  const info = productMap.get(iwasku);

  return NextResponse.json({
    success: true,
    data: {
      iwasku,
      asin: info?.asin ?? null,
      productName: info?.name ?? null,
      stocks: stocks
        .filter((s) => s.quantity - s.reservedQty > 0)
        .map((s) => ({
          id: s.id,
          shelfId: s.shelfId,
          shelfCode: s.shelf.code,
          shelfType: s.shelf.shelfType,
          quantity: s.quantity,
          reservedQty: s.reservedQty,
          availableQty: s.quantity - s.reservedQty,
        })),
      boxes: boxes
        .filter((b) => b.quantity - b.reservedQty > 0)
        .map((b) => ({
          id: b.id,
          shelfId: b.shelfId,
          shelfCode: b.shelf.code,
          boxNumber: b.boxNumber,
          fnsku: b.fnsku,
          marketplaceCode: b.marketplaceCode,
          destination: b.destination,
          quantity: b.quantity,
          reservedQty: b.reservedQty,
          availableQty: b.quantity - b.reservedQty,
          status: b.status,
        })),
    },
  });
}
