/**
 * GET /api/depolar/[code]/arama?q=...
 * Depo içi arama: SKU/iwasku, FNSKU, raf kodu, koli numarası, ürün adı.
 * Case-insensitive. Tüm eşleşen ShelfStock ve ShelfBox kayıtlarını döner.
 */

import { NextResponse } from 'next/server';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getProductsByIwasku } from '@/lib/products/lookup';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Arama başarısız' },
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
    if (q.length < 2) {
      return successResponse({ stocks: [], boxes: [], shelves: [], query: q });
    }

    // Pricelab'dan ad/FNSKU eşleşen iwasku'ları toparla (sku_master.fnsku tek noktada)
    let nameMatchIwaskus: string[] = [];
    let fnskuMatchIwaskus: string[] = [];
    try {
      const [nameRows, fnskuRows] = await Promise.all([
        queryProductDb(
          `SELECT product_sku FROM products WHERE name ILIKE $1 LIMIT 200`,
          [`%${q}%`]
        ),
        queryProductDb(
          `SELECT DISTINCT iwasku FROM sku_master
           WHERE fnsku IS NOT NULL AND fnsku ILIKE $1
           LIMIT 200`,
          [`%${q}%`]
        ),
      ]);
      nameMatchIwaskus = (nameRows as Array<{ product_sku: string }>).map((r) => r.product_sku);
      fnskuMatchIwaskus = (fnskuRows as Array<{ iwasku: string }>).map((r) => r.iwasku);
    } catch {
      // Pricelab erişimi yoksa name/FNSKU araması sessizce atlanır
    }
    const indirectIwaskus = [...new Set([...nameMatchIwaskus, ...fnskuMatchIwaskus])];

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

    // ShelfStock — iwasku VEYA isim/FNSKU eşleşmesi
    const stocks = await prisma.shelfStock.findMany({
      where: {
        warehouseCode: upperCode,
        OR: [
          { iwasku: { contains: q, mode: 'insensitive' } },
          ...(indirectIwaskus.length > 0 ? [{ iwasku: { in: indirectIwaskus } }] : []),
        ],
      },
      include: { shelf: { select: { code: true, shelfType: true } } },
      orderBy: { iwasku: 'asc' },
      take: 100,
    });

    // ShelfBox — iwasku, fnsku, boxNumber VEYA isim/FNSKU eşleşmesi
    const boxes = await prisma.shelfBox.findMany({
      where: {
        warehouseCode: upperCode,
        OR: [
          { iwasku: { contains: q, mode: 'insensitive' } },
          { fnsku: { contains: q, mode: 'insensitive' } },
          { boxNumber: { contains: q, mode: 'insensitive' } },
          ...(indirectIwaskus.length > 0 ? [{ iwasku: { in: indirectIwaskus } }] : []),
        ],
      },
      include: { shelf: { select: { code: true, shelfType: true } } },
      orderBy: [{ status: 'asc' }, { boxNumber: 'asc' }],
      take: 100,
    });

    // Product name lookup (batch)
    const allIwaskus = [...stocks.map((s) => s.iwasku), ...boxes.map((b) => b.iwasku)];
    const productMap = await getProductsByIwasku(allIwaskus);

    return successResponse({
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
    });
  }
);
