/**
 * Month Snapshot API
 * GET: Read snapshot for a locked month (auto-generates if missing)
 * POST: Manually trigger snapshot generation (admin only, any month)
 * Snapshot captures current warehouse "mevcut" at month boundary.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { queryProductDb } from '@/lib/db/prisma';
import { verifyAuth } from '@/lib/auth/verify';
import { isMonthLocked } from '@/lib/monthUtils';
import { errorResponse } from '@/lib/api/response';
import { createLogger } from '@/lib/logger';
import { getATPBulk } from '@/lib/db/atp';

const logger = createLogger('MonthSnapshot');

// snapshot.warehouseStock = ATP (mevcut − sezonRez − sevkRez).
// getATPBulk ile single source of truth. liveDemand kavramı kaldırıldı,
// snapshot ↔ ATP arasında çevrim yok, regenerate her seferinde aynı sonucu verir.
async function generateSnapshot(month: string): Promise<void> {
  const [requests, warehouseProducts] = await Promise.all([
    prisma.productionRequest.groupBy({
      by: ['iwasku'],
      where: { productionMonth: month },
      _sum: { quantity: true },
    }),
    prisma.warehouseProduct.findMany({ select: { iwasku: true } }),
  ]);

  const requestMap = new Map(requests.map(r => [r.iwasku, r._sum.quantity || 0]));
  const allIwaskus = [
    ...new Set([...requestMap.keys(), ...warehouseProducts.map(p => p.iwasku)]),
  ];
  if (allIwaskus.length === 0) return;

  const atpResults = await getATPBulk(allIwaskus);
  const atpMap = new Map(atpResults.map(r => [r.iwasku, r]));

  const upsertOps = allIwaskus
    .map(iwasku => {
      const totalRequested = requestMap.get(iwasku) || 0;
      const warehouseStock = atpMap.get(iwasku)?.atp ?? 0;
      if (totalRequested === 0 && warehouseStock === 0) return null;
      const netProduction = Math.max(0, totalRequested - warehouseStock);
      return prisma.monthSnapshot.upsert({
        where: { month_iwasku: { month, iwasku } },
        update: { totalRequested, warehouseStock, netProduction },
        create: { month, iwasku, totalRequested, warehouseStock, netProduction },
      });
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (upsertOps.length === 0) return;

  await prisma.$transaction(upsertOps);
  logger.info(`Snapshot generated for ${month}: ${upsertOps.length} products`);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 });
    }

    const month = request.nextUrl.searchParams.get('month');
    if (!month) {
      return NextResponse.json({ success: false, error: 'month parametresi gerekli' }, { status: 400 });
    }

    const locked = isMonthLocked(month);

    // Lazy trigger: generate if missing (only for locked months)
    if (locked) {
      const existingCount = await prisma.monthSnapshot.count({ where: { month } });
      if (existingCount === 0) {
        await generateSnapshot(month);
      }
    }

    // Fetch snapshots
    const snapshots = await prisma.monthSnapshot.findMany({
      where: { month },
      orderBy: { iwasku: 'asc' },
    });

    // Enrich with product details
    const iwaskus = snapshots.map(s => s.iwasku);
    let productMap: Record<string, { name: string; category: string; desi: number | null }> = {};

    if (iwaskus.length > 0) {
      const placeholders = iwaskus.map((_, i) => `$${i + 1}`).join(',');
      const products = await queryProductDb(
        `SELECT product_sku, name, category, COALESCE(manual_size, size) as size FROM products WHERE product_sku IN (${placeholders})`,
        iwaskus
      );
      productMap = Object.fromEntries(
        products.map((p: { product_sku: string; name: string; category: string; size: number | null }) => [
          p.product_sku,
          { name: p.name, category: p.category, desi: p.size },
        ])
      );
    }

    const enriched = snapshots.map(s => ({
      ...s,
      productName: productMap[s.iwasku]?.name || s.iwasku,
      productCategory: productMap[s.iwasku]?.category || '',
      desi: productMap[s.iwasku]?.desi || null,
    }));

    // Özet: sadece talep edilen ürünlerin stoku (talepsiz depodakiler dahil değil)
    const requested = snapshots.filter(s => s.totalRequested > 0);
    const totalRequested = requested.reduce((sum, s) => sum + s.totalRequested, 0);
    const totalStock = requested.reduce((sum, s) => sum + s.warehouseStock, 0);
    const totalNet = requested.reduce((sum, s) => sum + s.netProduction, 0);

    return NextResponse.json({
      success: true,
      data: {
        month,
        locked,
        snapshotCount: snapshots.length,
        summary: { totalRequested, totalStock, totalNet },
        snapshots: enriched,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Snapshot verisi getirilemedi');
  }
}

/**
 * POST: Manually trigger snapshot generation (admin only)
 * Forces regeneration even if snapshots already exist (upsert)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 });
    }
    if (auth.user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Yalnızca admin kullanabilir' }, { status: 403 });
    }

    const body = await request.json();
    const month = body.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ success: false, error: 'Geçerli month parametresi gerekli (YYYY-MM)' }, { status: 400 });
    }

    await generateSnapshot(month);

    const count = await prisma.monthSnapshot.count({ where: { month } });

    return NextResponse.json({
      success: true,
      data: { month, snapshotCount: count, message: `${count} ürün için snapshot alındı` },
    });
  } catch (error) {
    return errorResponse(error, 'Snapshot oluşturulamadı');
  }
}
