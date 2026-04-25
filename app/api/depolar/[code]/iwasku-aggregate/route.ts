/**
 * GET /api/depolar/[code]/iwasku-aggregate
 * Bir deponun (iwasku, fnsku) BAZLI aggregate'ı — Dashboard tablosu için.
 * Aynı iwasku farklı FNSKU'larla listelenmişse AYRI satır olarak görünür.
 * ShelfStock'un FNSKU'su yok → fnsku=null satırlarda gösterilir.
 *
 * Sadece SHELF_PRIMARY depolar (NJ, SHOWROOM) için anlamlı.
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

  const [stockAgg, boxAgg] = await Promise.all([
    prisma.shelfStock.groupBy({
      by: ['iwasku'],
      where: { warehouseCode: upperCode },
      _sum: { quantity: true, reservedQty: true },
      _count: true,
    }),
    prisma.shelfBox.groupBy({
      by: ['iwasku', 'fnsku'],
      where: { warehouseCode: upperCode, status: { not: 'EMPTY' } },
      _sum: { quantity: true, reservedQty: true },
      _count: true,
    }),
  ]);

  type Row = {
    iwasku: string;
    fnsku: string | null;
    looseQty: number;
    looseReservedQty: number;
    looseShelves: number;
    boxQty: number;
    boxReservedQty: number;
    boxCount: number;
  };
  const map = new Map<string, Row>();
  const keyOf = (iwasku: string, fnsku: string | null) => `${iwasku}|${fnsku ?? ''}`;

  // ShelfStock → fnsku=null satırlar (loose ürünlerin FNSKU bilgisi yok)
  for (const s of stockAgg) {
    const k = keyOf(s.iwasku, null);
    const cur = map.get(k) ?? {
      iwasku: s.iwasku, fnsku: null,
      looseQty: 0, looseReservedQty: 0, looseShelves: 0,
      boxQty: 0, boxReservedQty: 0, boxCount: 0,
    };
    cur.looseQty = s._sum.quantity ?? 0;
    cur.looseReservedQty = s._sum.reservedQty ?? 0;
    cur.looseShelves = s._count;
    map.set(k, cur);
  }

  // ShelfBox (iwasku, fnsku) → kendi satırı
  for (const b of boxAgg) {
    const k = keyOf(b.iwasku, b.fnsku);
    const cur = map.get(k) ?? {
      iwasku: b.iwasku, fnsku: b.fnsku,
      looseQty: 0, looseReservedQty: 0, looseShelves: 0,
      boxQty: 0, boxReservedQty: 0, boxCount: 0,
    };
    cur.boxQty = b._sum.quantity ?? 0;
    cur.boxReservedQty = b._sum.reservedQty ?? 0;
    cur.boxCount = b._count;
    map.set(k, cur);
  }

  const iwaskus = Array.from(new Set(Array.from(map.values()).map((r) => r.iwasku)));
  const productMap = await getProductsByIwasku(iwaskus);

  const rows = Array.from(map.values()).map((r) => {
    const info = productMap.get(r.iwasku);
    return {
      ...r,
      totalQty: r.looseQty + r.boxQty,
      totalReservedQty: r.looseReservedQty + r.boxReservedQty,
      productName: info?.name ?? null,
      category: info?.category ?? null,
      asin: info?.asin ?? null,
    };
  });
  // Sıralama: iwasku → fnsku (null önce), totalQty desc'e değil iwasku gruplarını korur
  rows.sort((a, b) => {
    if (a.iwasku !== b.iwasku) return a.iwasku.localeCompare(b.iwasku);
    if (a.fnsku === null && b.fnsku !== null) return -1;
    if (a.fnsku !== null && b.fnsku === null) return 1;
    return (a.fnsku ?? '').localeCompare(b.fnsku ?? '');
  });

  return NextResponse.json({
    success: true,
    data: { rows, total: rows.length },
  });
}
