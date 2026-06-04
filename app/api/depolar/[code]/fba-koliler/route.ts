/**
 * GET /api/depolar/[code]/fba-koliler
 * Pickup (koli-bazlı çıkış) için uygun koliler:
 *   - status=SEALED (mühürlü, dokunulmamış)
 *   - reservedQty=0 (başka siparişe ayrılmamış)
 *
 * Hedef (Amazon US/Citi, CG Depo) pickup'ta operatör seçer; koli marketplace'ine
 * göre kısıtlamayız — tüm uygun koliler listelenir, opsiyonel marketplaceCode
 * filtresi + arama ile daraltılır.
 *
 * Query: q (boxNumber/iwasku/fnsku contains), shelfCode, marketplaceCode
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getProductsByIwasku } from '@/lib/products/lookup';
import type { Prisma } from '@prisma/client';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'FBA koliler alınamadı' },
  async ({ request, params }) => {
    const { code } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }

    const auth = await requireShelfAction(request, upperCode, 'view');
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() ?? '';
    const shelfCode = searchParams.get('shelfCode')?.trim();
    const marketplaceFilter = searchParams.get('marketplaceCode')?.trim();

    const where: Prisma.ShelfBoxWhereInput = {
      warehouseCode: upperCode,
      status: 'SEALED',
      reservedQty: 0,
      ...(marketplaceFilter ? { marketplaceCode: marketplaceFilter } : {}),
    };
    if (q) {
      where.OR = [
        { boxNumber: { contains: q, mode: 'insensitive' } },
        { iwasku: { contains: q, mode: 'insensitive' } },
        { fnsku: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (shelfCode) {
      where.shelf = { code: shelfCode, warehouseCode: upperCode };
    }

    const boxes = await prisma.shelfBox.findMany({
      where,
      include: { shelf: { select: { code: true } } },
      orderBy: [{ marketplaceCode: 'asc' }, { boxNumber: 'asc' }],
      take: 500,
    });

    // Mevcut marketplace değerlerini topla (filter UI için)
    const marketplaces = Array.from(
      new Set(boxes.map((b) => b.marketplaceCode).filter(Boolean) as string[])
    ).sort();

    // Product names
    const productMap = await getProductsByIwasku(boxes.map((b) => b.iwasku));

    return successResponse({
      marketplaces,
      boxes: boxes.map((b) => ({
        id: b.id,
        boxNumber: b.boxNumber,
        iwasku: b.iwasku,
        productName: productMap.get(b.iwasku)?.name ?? null,
        fnsku: b.fnsku,
        marketplaceCode: b.marketplaceCode,
        destination: b.destination,
        quantity: b.quantity,
        shelfCode: b.shelf.code,
      })),
    });
  }
);
