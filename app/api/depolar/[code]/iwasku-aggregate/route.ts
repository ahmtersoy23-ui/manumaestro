/**
 * GET /api/depolar/[code]/iwasku-aggregate
 * Bir deponun tüm iwasku'larını aggregate olarak döner — Dashboard tablosu için.
 * Her iwasku için: tekil toplam, raf sayısı, koli toplam, koli sayısı, toplam adet.
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
      by: ['iwasku'],
      where: { warehouseCode: upperCode, status: { not: 'EMPTY' } },
      _sum: { quantity: true, reservedQty: true },
      _count: true,
    }),
  ]);

  // İki kaynaktan iwasku merge
  type Row = {
    iwasku: string;
    looseQty: number;
    looseReservedQty: number;
    looseShelves: number;
    boxQty: number;
    boxReservedQty: number;
    boxCount: number;
  };
  const map = new Map<string, Row>();

  for (const s of stockAgg) {
    const cur = map.get(s.iwasku) ?? {
      iwasku: s.iwasku, looseQty: 0, looseReservedQty: 0, looseShelves: 0,
      boxQty: 0, boxReservedQty: 0, boxCount: 0,
    };
    cur.looseQty = s._sum.quantity ?? 0;
    cur.looseReservedQty = s._sum.reservedQty ?? 0;
    cur.looseShelves = s._count;
    map.set(s.iwasku, cur);
  }

  for (const b of boxAgg) {
    const cur = map.get(b.iwasku) ?? {
      iwasku: b.iwasku, looseQty: 0, looseReservedQty: 0, looseShelves: 0,
      boxQty: 0, boxReservedQty: 0, boxCount: 0,
    };
    cur.boxQty = b._sum.quantity ?? 0;
    cur.boxReservedQty = b._sum.reservedQty ?? 0;
    cur.boxCount = b._count;
    map.set(b.iwasku, cur);
  }

  const iwaskus = Array.from(map.keys());
  const productMap = await getProductsByIwasku(iwaskus);

  const rows = Array.from(map.values()).map((r) => ({
    ...r,
    totalQty: r.looseQty + r.boxQty,
    totalReservedQty: r.looseReservedQty + r.boxReservedQty,
    productName: productMap.get(r.iwasku)?.name ?? null,
    category: productMap.get(r.iwasku)?.category ?? null,
  }));
  rows.sort((a, b) => b.totalQty - a.totalQty);

  return NextResponse.json({
    success: true,
    data: { rows, total: rows.length },
  });
}
