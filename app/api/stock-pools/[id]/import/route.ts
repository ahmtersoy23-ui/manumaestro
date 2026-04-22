/**
 * Stock Pool Import API
 * POST: Import reserves from Excel + auto-allocate to months
 *
 * Excel format (per-marketplace sheets, sheet name = marketplace.code like AMZN_US, WAYFAIR_US):
 *   iwasku | kategori | desi | q4 26 | q1 27
 *
 * Frontend merges all sheets and sends:
 *   { iwasku, quantity, desi?, category?, marketplace? }[]   // marketplace = Marketplace.code
 *
 * DB: stock_reserves.marketplaceSplit key = marketplace code (AMZN_US, WAYFAIR_US...)
 * Allocator input: region keyli split (AMZN_US + WAYFAIR_US → US) — Marketplace.code → region map ile türetilir
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { queryProductDb } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import {
  allocateReserves,
  loadCodeToRegionMap,
  marketplaceSplitToRegionSplit,
  type ReserveInput,
  type MonthCapacity,
} from '@/lib/seasonal';
import { z } from 'zod';

const ImportItemSchema = z.object({
  iwasku: z.string().min(1),
  quantity: z.number().int().positive(),
  desi: z.number().min(0).optional(),
  category: z.string().optional(),
  marketplace: z.string().optional(), // Marketplace.code: "AMZN_US", "WAYFAIR_US", "BOL_NL"...
});

const ImportSchema = z.object({
  items: z.array(ImportItemSchema).min(1).max(5000),
  months: z.array(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    workingDays: z.number().int().positive(),
    desiPerDay: z.number().positive(),
  })).min(1),
  autoAllocate: z.boolean().default(true),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireRole(request, ['admin', 'editor']);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  const { id } = await params;

  // Verify pool exists and is active
  const pool = await prisma.stockPool.findUnique({ where: { id } });
  if (!pool) {
    return NextResponse.json({ success: false, error: 'Havuz bulunamadı' }, { status: 404 });
  }
  if (pool.status !== 'ACTIVE') {
    return NextResponse.json({ success: false, error: 'Sadece aktif havuzlara aktarım yapılabilir' }, { status: 400 });
  }

  const body = await request.json();
  const validation = ImportSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { items, months, autoAllocate } = validation.data;

  // Editor: sadece canEdit=true olan pazar yerlerine veri girebilir
  if (user.role !== 'admin') {
    const editableCodes = new Set(
      (await prisma.userMarketplacePermission.findMany({
        where: { userId: user.id, canEdit: true },
        select: { marketplace: { select: { code: true } } },
      })).map(r => r.marketplace.code)
    );
    const itemsMpCodes = new Set(items.map(i => i.marketplace).filter((c): c is string => !!c));
    const forbidden = [...itemsMpCodes].filter(c => !editableCodes.has(c));
    if (forbidden.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Şu pazar yerlerine düzenleme yetkiniz yok: ${forbidden.join(', ')}`,
      }, { status: 403 });
    }
    // Marketplace belirtilmemiş satır (generic quantity) editor için kabul edilmez
    if (items.some(i => !i.marketplace)) {
      return NextResponse.json({
        success: false,
        error: 'Her satır için pazar yeri belirtilmelidir (editor rolü generic talep giremez)',
      }, { status: 403 });
    }
  }

  // Enrich items with product data from pricelab_db if desi/category missing
  const iwaskusNeedingEnrichment = items.filter(i => !i.desi || !i.category).map(i => i.iwasku);
  const productDataMap = new Map<string, { desi: number; category: string }>();

  if (iwaskusNeedingEnrichment.length > 0) {
    try {
      const placeholders = iwaskusNeedingEnrichment.map((_, i) => `$${i + 1}`).join(',');
      const rows = await queryProductDb(
        `SELECT product_sku AS iwasku, COALESCE(manual_size, size) AS desi, category
         FROM products WHERE product_sku IN (${placeholders}) AND COALESCE(manual_size, size) > 0`,
        iwaskusNeedingEnrichment
      );
      for (const row of rows) {
        productDataMap.set(row.iwasku, {
          desi: parseFloat(row.desi) || 0,
          category: row.category || '',
        });
      }
    } catch {
      // Continue without enrichment — desi will be 0
    }
  }

  // Merge items by iwasku (same product from different marketplace sheets)
  const mergedMap = new Map<string, {
    quantity: number; desi: number; category: string;
    marketplaceSplit: Record<string, number>;
  }>();

  for (const item of items) {
    const existing = mergedMap.get(item.iwasku);
    const enriched = productDataMap.get(item.iwasku);

    if (existing) {
      existing.quantity += item.quantity;
      if (item.marketplace) {
        existing.marketplaceSplit[item.marketplace] =
          (existing.marketplaceSplit[item.marketplace] ?? 0) + item.quantity;
      }
    } else {
      const split: Record<string, number> = {};
      if (item.marketplace) {
        split[item.marketplace] = item.quantity;
      }
      mergedMap.set(item.iwasku, {
        quantity: item.quantity,
        desi: item.desi ?? enriched?.desi ?? 0,
        category: item.category ?? enriched?.category ?? '',
        marketplaceSplit: split,
      });
    }
  }

  // Marketplace.code → region lookup (allocator region keyli split bekler)
  const codeToRegion = await loadCodeToRegionMap();

  // Mevcut reserve'ler ve split'leri: (iwasku, marketplace) çakışma tespiti için
  const existingReserves = await prisma.stockReserve.findMany({
    where: { poolId: id, iwasku: { in: [...mergedMap.keys()] } },
    select: { iwasku: true, marketplaceSplit: true, desiPerUnit: true },
  });
  const existingSplitByIwasku = new Map<string, Record<string, number>>();
  const existingDesiByIwasku = new Map<string, number>();
  for (const r of existingReserves) {
    existingSplitByIwasku.set(r.iwasku, (r.marketplaceSplit as Record<string, number>) ?? {});
    if (r.desiPerUnit) existingDesiByIwasku.set(r.iwasku, r.desiPerUnit);
  }

  // Çakışma tespiti: aynı (iwasku, marketplace) zaten mevcutsa reddet.
  // Toplama/üzerine yazma yok — hatalı girişleri admin silmeli, sonra tekrar yüklenmeli.
  const conflicts: { iwasku: string; marketplace: string; existingQty: number }[] = [];
  for (const [iwasku, data] of mergedMap) {
    const existing = existingSplitByIwasku.get(iwasku) ?? {};
    for (const mpCode of Object.keys(data.marketplaceSplit)) {
      if ((existing[mpCode] ?? 0) > 0) {
        conflicts.push({ iwasku, marketplace: mpCode, existingQty: existing[mpCode]! });
      }
    }
  }
  if (conflicts.length > 0) {
    const sample = conflicts.slice(0, 10)
      .map(c => `${c.iwasku} / ${c.marketplace} (mevcut: ${c.existingQty})`)
      .join('\n');
    const extraLine = conflicts.length > 10 ? `\n...ve ${conflicts.length - 10} satır daha` : '';
    return NextResponse.json({
      success: false,
      error: `${conflicts.length} satır zaten girilmiş. Düzeltmek için admin ile iletişime geçin.\n\n${sample}${extraLine}`,
      conflicts,
    }, { status: 409 });
  }

  // Create reserves in transaction
  const reserveInputs: ReserveInput[] = [];
  const createdReserves = await prisma.$transaction(async (tx) => {
    const results = [];

    for (const [iwasku, data] of mergedMap) {
      const existingSplit = existingSplitByIwasku.get(iwasku) ?? {};
      const mergedSplit = { ...existingSplit, ...data.marketplaceSplit };
      const mergedQty = Object.values(mergedSplit).reduce((s, v) => s + v, 0);
      // desi öncelik sırası: yeni import'ta varsa > DB'deki mevcut > katalog enrich > 0
      const effectiveDesi = data.desi || existingDesiByIwasku.get(iwasku) || 0;

      const reserve = await tx.stockReserve.upsert({
        where: { poolId_iwasku: { poolId: id, iwasku } },
        create: {
          poolId: id,
          iwasku,
          targetQuantity: mergedQty,
          targetDesi: mergedQty * effectiveDesi,
          desiPerUnit: effectiveDesi || null,
          category: data.category || null,
          marketplaceSplit: Object.keys(mergedSplit).length > 0 ? mergedSplit : undefined,
        },
        update: {
          targetQuantity: mergedQty,
          targetDesi: mergedQty * effectiveDesi,
          desiPerUnit: effectiveDesi || null,
          category: data.category || null,
          marketplaceSplit: Object.keys(mergedSplit).length > 0 ? mergedSplit : undefined,
        },
      });

      results.push(reserve);
      reserveInputs.push({
        iwasku,
        targetQuantity: mergedQty,
        desiPerUnit: effectiveDesi,
        category: data.category,
        marketplaceSplit: marketplaceSplitToRegionSplit(mergedSplit, codeToRegion),
      });
    }

    return results;
  });

  // Auto-allocate to months
  let allocations: { iwasku: string; month: string; plannedQty: number; plannedDesi: number }[] = [];

  if (autoAllocate && months.length > 0) {
    const monthCapacities: MonthCapacity[] = months.map(m => ({
      month: m.month,
      workingDays: m.workingDays,
      desiPerDay: m.desiPerDay,
      totalDesi: m.workingDays * m.desiPerDay,
      weight: 0, // Will be calculated
    }));

    allocations = allocateReserves(reserveInputs, monthCapacities);

    // Save allocations
    const reserveMap = new Map(createdReserves.map(r => [r.iwasku, r.id]));

    await prisma.$transaction(async (tx) => {
      // Delete existing allocations for this pool
      const reserveIds = createdReserves.map(r => r.id);
      await tx.monthlyAllocation.deleteMany({
        where: { reserveId: { in: reserveIds } },
      });

      // Create new allocations
      for (const alloc of allocations) {
        const reserveId = reserveMap.get(alloc.iwasku);
        if (!reserveId) continue;

        await tx.monthlyAllocation.create({
          data: {
            reserveId,
            month: alloc.month,
            plannedQty: alloc.plannedQty,
            plannedDesi: alloc.plannedDesi,
          },
        });
      }
    });
  }

  // Update pool totals — merge sonrası tüm reserve'ler üzerinden
  const allPoolReserves = await prisma.stockReserve.findMany({
    where: { poolId: id },
    select: { targetQuantity: true, targetDesi: true },
  });
  const totalUnits = allPoolReserves.reduce((s, r) => s + r.targetQuantity, 0);
  const totalDesi = allPoolReserves.reduce((s, r) => s + (r.targetDesi ?? 0), 0);

  await prisma.stockPool.update({
    where: { id },
    data: {
      totalTargetUnits: totalUnits,
      totalTargetDesi: Math.round(totalDesi),
    },
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'BULK_UPLOAD', entityType: 'StockPool', entityId: id,
    description: `Sezon planı aktarıldı: ${mergedMap.size} ürün, ${totalUnits} ünite, ${Math.round(totalDesi)} desi`,
    metadata: { productCount: mergedMap.size, totalUnits, totalDesi: Math.round(totalDesi) },
  });

  return NextResponse.json({
    success: true,
    data: {
      reservesCreated: createdReserves.length,
      totalUnits,
      totalDesi: Math.round(totalDesi),
      allocationsCreated: allocations.length,
      monthSummary: autoAllocate ? (await import('@/lib/seasonal')).summarizeByMonth(allocations) : [],
    },
  }, { status: 201 });
}
