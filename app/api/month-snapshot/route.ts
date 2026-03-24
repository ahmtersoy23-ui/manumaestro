/**
 * Month Snapshot API
 * GET: Read snapshot for a locked month (auto-generates if missing)
 *
 * Lazy trigger: When a locked month is accessed and no snapshot exists,
 * the system automatically calculates and stores it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { queryProductDb } from '@/lib/db/prisma';
import { verifyAuth } from '@/lib/auth/verify';
import { isMonthLocked } from '@/lib/monthUtils';
import { errorResponse } from '@/lib/api/response';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MonthSnapshot');

async function generateSnapshot(month: string): Promise<void> {
  // 1. Aggregate all production requests for this month by IWASKU
  const requests = await prisma.productionRequest.groupBy({
    by: ['iwasku'],
    where: { productionMonth: month },
    _sum: { quantity: true },
  });

  if (requests.length === 0) return;

  // 2. Get warehouse stock (initial stock: weekLabel IS NULL) for this month
  const stockEntries = await prisma.warehouseStock.findMany({
    where: { month, weekLabel: null },
  });
  const stockMap = new Map(stockEntries.map(s => [s.iwasku, s.quantity]));

  // 3. Calculate and store snapshots
  const snapshots = requests.map(r => ({
    month,
    iwasku: r.iwasku,
    totalRequested: r._sum.quantity || 0,
    warehouseStock: stockMap.get(r.iwasku) || 0,
    netProduction: Math.max(0, (r._sum.quantity || 0) - (stockMap.get(r.iwasku) || 0)),
  }));

  // Upsert all snapshots (in case of re-generation)
  for (const snap of snapshots) {
    const existing = await prisma.monthSnapshot.findFirst({
      where: { month: snap.month, iwasku: snap.iwasku },
    });
    if (existing) {
      await prisma.monthSnapshot.update({
        where: { id: existing.id },
        data: snap,
      });
    } else {
      await prisma.monthSnapshot.create({ data: snap });
    }
  }

  logger.info(`Snapshot generated for ${month}: ${snapshots.length} products`);
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

    // Only locked months can have snapshots
    if (!isMonthLocked(month)) {
      return NextResponse.json({
        success: true,
        data: { month, locked: false, snapshots: [] },
      });
    }

    // Check if snapshot exists
    const existingCount = await prisma.monthSnapshot.count({ where: { month } });

    // Lazy trigger: generate snapshot if missing
    if (existingCount === 0) {
      await generateSnapshot(month);
    }

    // Fetch snapshots
    const snapshots = await prisma.monthSnapshot.findMany({
      where: { month },
      orderBy: { iwasku: 'asc' },
    });

    // Enrich with product details from pricelab_db
    const iwaskus = snapshots.map(s => s.iwasku);
    let productMap: Record<string, { name: string; category: string; desi: number | null }> = {};

    if (iwaskus.length > 0) {
      const placeholders = iwaskus.map((_, i) => `$${i + 1}`).join(',');
      const products = await queryProductDb(
        `SELECT product_sku, name, category, size FROM products WHERE product_sku IN (${placeholders})`,
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

    // Summary stats
    const totalRequested = snapshots.reduce((sum, s) => sum + s.totalRequested, 0);
    const totalStock = snapshots.reduce((sum, s) => sum + s.warehouseStock, 0);
    const totalNet = snapshots.reduce((sum, s) => sum + s.netProduction, 0);

    return NextResponse.json({
      success: true,
      data: {
        month,
        locked: true,
        snapshotCount: snapshots.length,
        summary: { totalRequested, totalStock, totalNet },
        snapshots: enriched,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Snapshot verisi getirilemedi');
  }
}
