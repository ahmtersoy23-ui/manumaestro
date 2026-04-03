/**
 * Stock Pool Release API
 * POST: Convert approved MonthlyAllocations → ProductionRequests under "Sezon" marketplace
 *
 * Idempotent: deletes existing UNLOCKED Sezon requests for this pool, then recreates.
 * Locked months' requests are never touched.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { queryProductDb } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { waterfallComplete } from '@/lib/waterfallComplete';

type Params = { params: Promise<{ id: string }> };

const SEZON_MARKETPLACE_CODE = 'SEZON';

export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  const { id } = await params;

  const pool = await prisma.stockPool.findUnique({
    where: { id },
    include: {
      reserves: {
        where: { status: { not: 'CANCELLED' } },
        include: {
          allocations: {
            where: { plannedQty: { gt: 0 } },
          },
        },
      },
    },
  });

  if (!pool) {
    return NextResponse.json({ success: false, error: 'Havuz bulunamadı' }, { status: 404 });
  }
  if (pool.status !== 'ACTIVE' && pool.status !== 'RELEASING') {
    return NextResponse.json(
      { success: false, error: 'Sadece aktif veya releasing havuzlar aktarılabilir' },
      { status: 400 }
    );
  }

  const allAllocations = pool.reserves.flatMap(r =>
    r.allocations.map(a => ({
      ...a,
      iwasku: r.iwasku,
      category: r.category,
      desiPerUnit: r.desiPerUnit ?? (r.targetDesi && r.targetQuantity ? r.targetDesi / r.targetQuantity : null),
    }))
  );

  if (allAllocations.length === 0) {
    return NextResponse.json({ success: false, error: 'Onaylı dağılım bulunamadı' }, { status: 400 });
  }

  // Find or create "Sezon" marketplace
  let sezonMarketplace = await prisma.marketplace.findUnique({
    where: { code: SEZON_MARKETPLACE_CODE },
  });
  if (!sezonMarketplace) {
    sezonMarketplace = await prisma.marketplace.create({
      data: {
        name: 'Sezon',
        code: SEZON_MARKETPLACE_CODE,
        marketplaceType: 'CUSTOM',
        region: 'TR',
        isCustom: true,
        isActive: true,
        colorTag: '#8B5CF6',
        createdById: user.id,
      },
    });
  }

  // Fetch product names + categories from pricelab_db
  const iwaskus = [...new Set(pool.reserves.map(r => r.iwasku))];
  const productMap = new Map<string, { name: string; category: string; desi: number | null }>();
  if (iwaskus.length > 0) {
    try {
      const ph = iwaskus.map((_, i) => `$${i + 1}`).join(',');
      const rows = await queryProductDb(
        `SELECT product_sku, name, category, COALESCE(manual_size, size) as desi FROM products WHERE product_sku IN (${ph})`,
        iwaskus
      ) as { product_sku: string; name: string; category: string; desi: number | null }[];
      for (const row of rows) {
        productMap.set(row.product_sku, {
          name: row.name,
          category: row.category,
          desi: row.desi,
        });
      }
    } catch { /* continue with fallback */ }
  }

  // Locked months — don't touch their requests
  const lockedMonths = new Set(
    allAllocations.filter(a => a.locked).map(a => a.month)
  );

  // Find existing Sezon ProductionRequests for this pool's reserves
  // Identify by iwasku + marketplace + notes containing pool id
  // Use a pool-specific note tag so we can target them precisely
  const poolTag = `[pool:${id}]`;

  // Delete unlocked months' existing Sezon requests for this pool
  const unlockedMonths = allAllocations
    .filter(a => !lockedMonths.has(a.month))
    .map(a => a.month);

  if (unlockedMonths.length > 0) {
    await prisma.productionRequest.deleteMany({
      where: {
        marketplaceId: sezonMarketplace.id,
        notes: { contains: poolTag },
        productionMonth: { in: unlockedMonths },
      },
    });
  }

  // Create new ProductionRequests for unlocked allocations
  const toCreate = allAllocations.filter(a => !lockedMonths.has(a.month));
  let created = 0;

  for (const alloc of toCreate) {
    const product = productMap.get(alloc.iwasku);
    await prisma.productionRequest.create({
      data: {
        iwasku: alloc.iwasku,
        productName: product?.name ?? alloc.iwasku,
        productCategory: alloc.category ?? product?.category ?? '',
        productSize: alloc.desiPerUnit ?? product?.desi ?? null,
        marketplaceId: sezonMarketplace.id,
        quantity: alloc.plannedQty,
        productionMonth: alloc.month,
        entryType: 'EXCEL',
        status: 'REQUESTED',
        priority: 'MEDIUM',
        enteredById: user.id,
        notes: poolTag,
      },
    });
    created++;
  }

  // Ensure SEZON marketplace has lowest priority for each released month
  const releasedMonths = [...new Set(toCreate.map(a => a.month))];
  for (const month of releasedMonths) {
    // Get current max priority for this month
    const maxPriority = await prisma.marketplacePriority.aggregate({
      where: { month },
      _max: { priority: true },
    });
    const sezonPriority = (maxPriority._max.priority ?? 0) + 1;

    await prisma.marketplacePriority.upsert({
      where: { month_marketplaceId: { month, marketplaceId: sezonMarketplace.id } },
      create: { month, marketplaceId: sezonMarketplace.id, priority: sezonPriority },
      update: { priority: sezonPriority },
    });
  }

  // Re-run waterfall for affected iwasku+month pairs
  // New SEZON requests change total demand → existing COMPLETED requests may need to revert
  const affectedPairs = new Set(toCreate.map(a => `${a.iwasku}|${a.month}`));
  let waterfallChanged = 0;
  for (const pair of affectedPairs) {
    const [iwasku, month] = pair.split('|');
    waterfallChanged += await waterfallComplete(iwasku, month);
  }

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'BULK_UPLOAD', entityType: 'StockPool', entityId: id,
    description: `Ay planına aktarıldı: ${created} istek oluşturuldu, ${lockedMonths.size} kilitli ay atlandı, ${waterfallChanged} waterfall güncellendi`,
    metadata: { created, lockedMonths: lockedMonths.size, sezonMarketplaceId: sezonMarketplace.id, waterfallChanged },
  });

  return NextResponse.json({
    success: true,
    data: {
      created,
      sezonMarketplaceId: sezonMarketplace.id,
      skippedLockedMonths: lockedMonths.size,
    },
  });
}
