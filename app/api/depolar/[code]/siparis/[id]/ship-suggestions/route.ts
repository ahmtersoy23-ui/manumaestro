/**
 * GET /api/depolar/[code]/siparis/[id]/ship-suggestions
 * Sipariş çıkış modal'ı için: her item için ürünün depodaki tüm konumları
 * (loose stock + koli, available > 0) + FIFO öneri pre-fill.
 *
 * Output:
 *   {
 *     items: [{
 *       itemId, iwasku, productName, requestedQty,
 *       candidates: [{ source, locationId, shelfId, shelfCode, shelfType,
 *                       availableQty, ageReference, boxNumber? ... }],
 *       suggestions: [{ source, locationId, shelfCode, suggestedQty, ageDays, rationale }],
 *       remaining: number   // 0 ise tam karşılanır; pozitif ise eksik stok
 *     }]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getProductsByIwasku } from '@/lib/products/lookup';
import { suggestPick, type PickCandidate } from '@/lib/wms/fifoSuggest';

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

  const iwaskus = Array.from(new Set(order.items.map((i) => i.iwasku)));
  if (iwaskus.length === 0) {
    return NextResponse.json({ success: true, data: { items: [] } });
  }

  // Tüm iwaskular için raf+koli kaynaklarını tek seferde çek
  const [stocks, boxes, productMap] = await Promise.all([
    prisma.shelfStock.findMany({
      where: { warehouseCode: upperCode, iwasku: { in: iwaskus } },
      include: { shelf: { select: { code: true, shelfType: true } } },
    }),
    prisma.shelfBox.findMany({
      where: { warehouseCode: upperCode, iwasku: { in: iwaskus }, status: { not: 'EMPTY' } },
      include: { shelf: { select: { code: true, shelfType: true } } },
    }),
    getProductsByIwasku(iwaskus),
  ]);

  // iwasku → candidates
  const candidatesByIwasku = new Map<string, PickCandidate[]>();
  for (const s of stocks) {
    const avail = s.quantity - s.reservedQty;
    if (avail <= 0) continue;
    const list = candidatesByIwasku.get(s.iwasku) ?? [];
    list.push({
      source: 'STOCK',
      locationId: s.id,
      shelfId: s.shelfId,
      shelfCode: s.shelf.code,
      shelfType: s.shelf.shelfType,
      availableQty: avail,
      ageReference: s.createdAt,
    });
    candidatesByIwasku.set(s.iwasku, list);
  }
  for (const b of boxes) {
    const avail = b.quantity - b.reservedQty;
    if (avail <= 0) continue;
    const list = candidatesByIwasku.get(b.iwasku) ?? [];
    list.push({
      source: 'BOX',
      locationId: b.id,
      shelfId: b.shelfId,
      shelfCode: b.shelf.code,
      shelfType: b.shelf.shelfType,
      availableQty: avail,
      ageReference: b.arrivedAt,
      boxNumber: b.boxNumber,
      fnsku: b.fnsku,
      marketplaceCode: b.marketplaceCode,
      status: b.status,
    });
    candidatesByIwasku.set(b.iwasku, list);
  }

  // Her item için suggest çağır
  const items = order.items.map((item) => {
    const candidates = candidatesByIwasku.get(item.iwasku) ?? [];
    const { suggestions, remaining } = suggestPick(candidates, item.quantity);
    return {
      itemId: item.id,
      iwasku: item.iwasku,
      productName: productMap.get(item.iwasku)?.name ?? null,
      requestedQty: item.quantity,
      candidates: candidates.map((c) => ({
        source: c.source,
        locationId: c.locationId,
        shelfId: c.shelfId,
        shelfCode: c.shelfCode,
        shelfType: c.shelfType,
        availableQty: c.availableQty,
        ageReference: c.ageReference.toISOString(),
        boxNumber: c.boxNumber,
        fnsku: c.fnsku,
        marketplaceCode: c.marketplaceCode,
        status: c.status,
      })),
      suggestions,
      remaining,
    };
  });

  return NextResponse.json({ success: true, data: { items } });
}
