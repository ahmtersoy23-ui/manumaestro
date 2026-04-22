/**
 * Stock Pool Allocation API
 * POST: Preview or approve monthly allocation
 *
 * Body: { months, approve: boolean }
 *   approve=false → returns calculated allocations without saving (preview)
 *   approve=true  → calculates and saves allocations to DB
 *
 * Lock mechanism:
 *   - Months where actualQty > 0 (production started) are LOCKED — never touched
 *   - Locked months' plannedQty counts as already fulfilled demand
 *   - Only unlocked months are recalculated and (re)written
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import {
  allocateReserves,
  computeSezonProduced,
  loadCodeToRegionMap,
  marketplaceSplitToRegionSplit,
  summarizeByMonth,
  type ReserveInput,
  type MonthCapacity,
} from '@/lib/seasonal';
import { z } from 'zod';

const AllocateSchema = z.object({
  months: z.array(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    workingDays: z.number().int().positive(),
    desiPerDay: z.number().positive(),
  })).min(1),
  approve: z.boolean().default(false),
  // true: Kilitli ayın plannedQty'si "karşılanmış" sayılır (eksikler yeni aylara girmez)
  // false: Kilitli ayın FİİLİ sezon üretimi (COMPLETED + partial payı) karşılanmış sayılır;
  //        plan - fiili = eksik, diğer açık aylara yeniden dağıtılır.
  includeMissedFromLocked: z.boolean().default(false),
});

type Params = { params: Promise<{ id: string }> };

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
        include: { allocations: true },
      },
    },
  });

  if (!pool) {
    return NextResponse.json({ success: false, error: 'Havuz bulunamadı' }, { status: 404 });
  }
  if (pool.status !== 'ACTIVE') {
    return NextResponse.json({ success: false, error: 'Sadece aktif havuzlarda dağılım yapılabilir' }, { status: 400 });
  }
  if (pool.reserves.length === 0) {
    return NextResponse.json({ success: false, error: 'Havuzda ürün yok' }, { status: 400 });
  }

  const body = await request.json();
  const validation = AllocateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { months, approve, includeMissedFromLocked } = validation.data;

  // ── Determine locked months (actualQty > 0 = production started) ──────────
  // A month is locked if ANY reserve has an allocation for it with actualQty > 0
  const lockedMonths = new Set<string>();
  for (const reserve of pool.reserves) {
    for (const alloc of reserve.allocations) {
      if (alloc.actualQty > 0 || alloc.locked) {
        lockedMonths.add(alloc.month);
      }
    }
  }

  // Collect locked allocations (to return in preview so frontend can show them)
  const lockedAllocations: { iwasku: string; month: string; plannedQty: number; plannedDesi: number; locked: true }[] = [];
  for (const reserve of pool.reserves) {
    for (const alloc of reserve.allocations) {
      if (lockedMonths.has(alloc.month)) {
        lockedAllocations.push({
          iwasku: reserve.iwasku,
          month: alloc.month,
          plannedQty: alloc.plannedQty,
          plannedDesi: alloc.plannedDesi ?? 0,
          locked: true,
        });
      }
    }
  }

  // Build reserve inputs. Kilitli ayda "karşılandı" sayılan miktar:
  // - includeMissedFromLocked=false (varsayılan): plan kadar (mevcut davranış)
  // - includeMissedFromLocked=true: fiili sezon üretimi kadar; eksik plan farkı
  //   açık aylara geri dağıtılsın diye o kısmı burada düşmüyoruz.
  const sezonProduced = includeMissedFromLocked
    ? await computeSezonProduced(id)
    : null;

  const lockedQtyByIwasku = new Map<string, number>();
  for (const la of lockedAllocations) {
    const consumedQty = sezonProduced
      ? (sezonProduced.byIwaskuMonth.get(`${la.iwasku}|${la.month}`)?.qty ?? 0)
      : la.plannedQty;
    lockedQtyByIwasku.set(la.iwasku, (lockedQtyByIwasku.get(la.iwasku) ?? 0) + consumedQty);
  }

  // DB'deki marketplaceSplit artık marketplace.code bazlı — allocator için region'a topla
  const codeToRegion = await loadCodeToRegionMap();

  const reserveInputs: ReserveInput[] = pool.reserves
    .map(r => {
      const lockedQty = lockedQtyByIwasku.get(r.iwasku) ?? 0;
      const remainingTarget = Math.max(0, r.targetQuantity - lockedQty);
      const regionSplit = marketplaceSplitToRegionSplit(
        r.marketplaceSplit as Record<string, number> | null,
        codeToRegion,
      );
      return {
        iwasku: r.iwasku,
        targetQuantity: remainingTarget,
        desiPerUnit: r.desiPerUnit ?? (r.targetDesi && r.targetQuantity > 0 ? r.targetDesi / r.targetQuantity : 0),
        category: r.category ?? '',
        marketplaceSplit: Object.keys(regionSplit).length > 0 ? regionSplit : undefined,
      };
    })
    .filter(r => r.targetQuantity > 0 && r.desiPerUnit > 0);

  // Only pass unlocked months to the allocator
  const unlockedMonths: MonthCapacity[] = months
    .filter(m => !lockedMonths.has(m.month))
    .map(m => ({
      month: m.month,
      workingDays: m.workingDays,
      desiPerDay: m.desiPerDay,
      totalDesi: m.workingDays * m.desiPerDay,
      weight: 0,
    }));

  // Run allocator on remaining demand × unlocked months
  const newAllocations = reserveInputs.length > 0 && unlockedMonths.length > 0
    ? allocateReserves(reserveInputs, unlockedMonths)
    : [];

  // Combine locked + new for summary
  const allAllocations = [
    ...lockedAllocations,
    ...newAllocations,
  ];
  const summary = summarizeByMonth(allAllocations);

  // Build quota info for all months
  const monthQuotas = months.map(m => ({
    month: m.month,
    workingDays: m.workingDays,
    desiPerDay: m.desiPerDay,
    quotaDesi: m.workingDays * m.desiPerDay,
    locked: lockedMonths.has(m.month),
  }));

  if (!approve) {
    return NextResponse.json({
      success: true,
      data: {
        preview: true,
        allocations: allAllocations,
        lockedMonths: Array.from(lockedMonths),
        summary,
        monthQuotas,
        totalProducts: pool.reserves.length,
        totalUnits: pool.reserves.reduce((s, r) => s + r.targetQuantity, 0),
      },
    });
  }

  // ── Approve: save only unlocked months' allocations ───────────────────────
  const reserveMap = new Map(pool.reserves.map(r => [r.iwasku, r.id]));

  await prisma.$transaction(async (tx) => {
    // Delete existing UNLOCKED allocations for this pool
    for (const reserve of pool.reserves) {
      await tx.monthlyAllocation.deleteMany({
        where: {
          reserveId: reserve.id,
          locked: false,
          month: { notIn: Array.from(lockedMonths) },
        },
      });
    }

    // Create new unlocked allocations
    for (const alloc of newAllocations) {
      const reserveId = reserveMap.get(alloc.iwasku);
      if (!reserveId) continue;

      await tx.monthlyAllocation.create({
        data: {
          reserveId,
          month: alloc.month,
          plannedQty: alloc.plannedQty,
          plannedDesi: alloc.plannedDesi,
          locked: false,
        },
      });
    }
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'BULK_UPLOAD', entityType: 'StockPool', entityId: id,
    description: `Aylık dağılım onaylandı: ${newAllocations.length} kayıt, ${unlockedMonths.length} açık ay, ${lockedMonths.size} kilitli ay`,
    metadata: { allocationCount: newAllocations.length, unlockedMonthCount: unlockedMonths.length, lockedMonthCount: lockedMonths.size },
  });

  return NextResponse.json({
    success: true,
    data: {
      preview: false,
      approved: true,
      allocationsCreated: newAllocations.length,
      lockedMonths: Array.from(lockedMonths),
      summary,
      monthQuotas,
    },
  });
}
