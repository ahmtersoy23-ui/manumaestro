/**
 * Month Snapshot API
 * GET: Read snapshot for a locked month (auto-generates if missing)
 * Snapshot captures current warehouse "mevcut" at month boundary.
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
  // 1. Get all production requests for this month, grouped by IWASKU
  const requests = await prisma.productionRequest.groupBy({
    by: ['iwasku'],
    where: { productionMonth: month },
    _sum: { quantity: true },
  });

  if (requests.length === 0) return;

  // 2. Get warehouse mevcut for each product
  const warehouseProducts = await prisma.warehouseProduct.findMany({
    include: { weeklyEntries: true },
  });

  const stockMap = new Map<string, number>();
  for (const p of warehouseProducts) {
    const uretilen = p.weeklyEntries.reduce((sum, w) => sum + w.quantity, 0);
    const mevcut = p.eskiStok + uretilen + p.ilaveStok - p.cikis;
    stockMap.set(p.iwasku, mevcut);
  }

  // 3. Calculate and store snapshots
  for (const r of requests) {
    const totalRequested = r._sum.quantity || 0;
    const warehouseStock = stockMap.get(r.iwasku) || 0;
    const netProduction = Math.max(0, totalRequested - warehouseStock);

    const existing = await prisma.monthSnapshot.findFirst({
      where: { month, iwasku: r.iwasku },
    });

    const data = { month, iwasku: r.iwasku, totalRequested, warehouseStock, netProduction };

    if (existing) {
      await prisma.monthSnapshot.update({ where: { id: existing.id }, data });
    } else {
      await prisma.monthSnapshot.create({ data });
    }
  }

  logger.info(`Snapshot generated for ${month}: ${requests.length} products`);
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

    if (!isMonthLocked(month)) {
      return NextResponse.json({
        success: true,
        data: { month, locked: false, snapshots: [] },
      });
    }

    // Lazy trigger: generate if missing
    const existingCount = await prisma.monthSnapshot.count({ where: { month } });
    if (existingCount === 0) {
      await generateSnapshot(month);
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
