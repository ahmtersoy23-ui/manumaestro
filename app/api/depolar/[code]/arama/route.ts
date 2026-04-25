/**
 * GET /api/depolar/[code]/arama?q=...
 * Depo içi arama: SKU/iwasku, FNSKU, raf kodu, koli numarası.
 * Case-insensitive. Tüm eşleşen ShelfStock ve ShelfBox kayıtlarını döner.
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

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({
      success: true,
      data: { stocks: [], boxes: [], shelves: [], query: q },
    });
  }

  // Önce raf kodu eşleşmeleri (sadece bu depo)
  const shelves = await prisma.shelf.findMany({
    where: {
      warehouseCode: upperCode,
      isActive: true,
      code: { contains: q, mode: 'insensitive' },
    },
    select: { id: true, code: true, shelfType: true },
    take: 30,
  });

  // ShelfStock — iwasku eşleşmesi
  const stocks = await prisma.shelfStock.findMany({
    where: {
      warehouseCode: upperCode,
      iwasku: { contains: q, mode: 'insensitive' },
    },
    include: { shelf: { select: { code: true, shelfType: true } } },
    orderBy: { iwasku: 'asc' },
    take: 100,
  });

  // ShelfBox — iwasku, fnsku veya boxNumber eşleşmesi
  const boxes = await prisma.shelfBox.findMany({
    where: {
      warehouseCode: upperCode,
      OR: [
        { iwasku: { contains: q, mode: 'insensitive' } },
        { fnsku: { contains: q, mode: 'insensitive' } },
        { boxNumber: { contains: q, mode: 'insensitive' } },
      ],
    },
    include: { shelf: { select: { code: true, shelfType: true } } },
    orderBy: [{ status: 'asc' }, { boxNumber: 'asc' }],
    take: 100,
  });

  // Product name lookup (batch)
  const allIwaskus = [...stocks.map((s) => s.iwasku), ...boxes.map((b) => b.iwasku)];
  const productMap = await getProductsByIwasku(allIwaskus);

  return NextResponse.json({
    success: true,
    data: {
      query: q,
      shelves,
      stocks: stocks.map((s) => ({
        id: s.id,
        shelfId: s.shelfId,
        shelfCode: s.shelf.code,
        shelfType: s.shelf.shelfType,
        iwasku: s.iwasku,
        productName: productMap.get(s.iwasku)?.name ?? null,
        quantity: s.quantity,
        reservedQty: s.reservedQty,
      })),
      boxes: boxes.map((b) => ({
        id: b.id,
        shelfId: b.shelfId,
        shelfCode: b.shelf.code,
        shelfType: b.shelf.shelfType,
        boxNumber: b.boxNumber,
        iwasku: b.iwasku,
        productName: productMap.get(b.iwasku)?.name ?? null,
        fnsku: b.fnsku,
        quantity: b.quantity,
        status: b.status,
      })),
    },
  });
}
