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
import { getSezonProducedByIwasku } from '@/lib/seasonal/sezonProduced';

const logger = createLogger('MonthSnapshot');

async function generateSnapshot(month: string): Promise<void> {
  // 1. Get all production requests for this month, grouped by IWASKU
  const requests = await prisma.productionRequest.groupBy({
    by: ['iwasku'],
    where: { productionMonth: month },
    _sum: { quantity: true },
  });

  // 2. Get warehouse mevcut for ALL products (not just those with requests)
  const warehouseProducts = await prisma.warehouseProduct.findMany({
    include: { weeklyEntries: true },
  });

  const stockMap = new Map<string, number>();
  for (const p of warehouseProducts) {
    const weeklyProd = p.weeklyEntries.filter(w => w.type === 'PRODUCTION').reduce((s, w) => s + w.quantity, 0);
    const weeklyShip = p.weeklyEntries.filter(w => w.type === 'SHIPMENT').reduce((s, w) => s + w.quantity, 0);
    const mevcut = p.eskiStok + weeklyProd + p.ilaveStok - p.cikis - weeklyShip;
    if (mevcut > 0) stockMap.set(p.iwasku, mevcut);
  }

  // 3. Sezon rezervi: (initialStock − shippedQuantity) + sezonProduced (dinamik)
  // StockReserve.producedQuantity alanı DB'de güncellenmiyor — waterfall simülasyonu kullan
  const seasonReserves = await prisma.stockReserve.findMany({
    where: { pool: { poolType: 'SEASONAL' }, status: { not: 'CANCELLED' } },
    select: { iwasku: true, initialStock: true, shippedQuantity: true },
  });
  const seasonMap = new Map<string, number>();
  for (const r of seasonReserves) {
    const reserved = r.initialStock - r.shippedQuantity;
    if (reserved <= 0) continue;
    seasonMap.set(r.iwasku, (seasonMap.get(r.iwasku) ?? 0) + reserved);
  }

  // 3b. Sezon havuzuna fiilen düşen üretim (waterfall simülasyonu)
  const requestMap = new Map(requests.map(r => [r.iwasku, r._sum.quantity || 0]));
  const allIwaskus = new Set([...requestMap.keys(), ...stockMap.keys()]);
  const sezonProducedMap = await getSezonProducedByIwasku([...allIwaskus]);
  for (const [iwasku, produced] of sezonProducedMap) {
    if (produced <= 0) continue;
    seasonMap.set(iwasku, (seasonMap.get(iwasku) ?? 0) + produced);
  }

  // 3c. Sevkiyat rezerve: kolilenmiş ama henüz sevk edilmemiş (Ankara çıkışlı)
  const shipItems = await prisma.shipmentItem.groupBy({
    by: ['iwasku'],
    where: { packed: true, sentAt: null },
    _sum: { quantity: true },
  });
  const shipmentReservedMap = new Map<string, number>();
  for (const s of shipItems) {
    shipmentReservedMap.set(s.iwasku, s._sum.quantity ?? 0);
  }

  if (allIwaskus.size === 0) return;

  // 5. Calculate and store snapshots
  const upsertOps = Array.from(allIwaskus).map(iwasku => {
    const totalRequested = requestMap.get(iwasku) || 0;
    const rawStock = stockMap.get(iwasku) || 0;
    const reserved = seasonMap.get(iwasku) || 0;
    const shipmentReserved = shipmentReservedMap.get(iwasku) || 0;
    // Sezon + sevkiyat rezerveleri düş — kolide olan ama sevk edilmemiş miktar da kullanılamaz
    const warehouseStock = Math.max(0, rawStock - reserved - shipmentReserved);
    const netProduction = Math.max(0, totalRequested - warehouseStock);

    return prisma.monthSnapshot.upsert({
      where: { month_iwasku: { month, iwasku } },
      update: { totalRequested, warehouseStock, netProduction },
      create: { month, iwasku, totalRequested, warehouseStock, netProduction },
    });
  });

  await prisma.$transaction(upsertOps);

  // Snapshot is informational only — does NOT trigger waterfall or change statuses.
  // Waterfall runs independently when manufacturer enters producedQuantity.
  logger.info(`Snapshot generated for ${month}: ${allIwaskus.size} products`);
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
