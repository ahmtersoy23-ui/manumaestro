/**
 * Stock Pool Allocation API
 * POST: Preview or approve monthly allocation
 *
 * Body: { months, approve: boolean }
 *   approve=false → returns calculated allocations without saving (preview)
 *   approve=true  → calculates and saves allocations to DB
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import {
  allocateReserves,
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

  const { months, approve } = validation.data;

  // Build reserve inputs from DB
  const reserveInputs: ReserveInput[] = pool.reserves.map(r => ({
    iwasku: r.iwasku,
    targetQuantity: r.targetQuantity,
    desiPerUnit: r.targetDesi ? r.targetDesi / r.targetQuantity : 0,
    category: r.category ?? '',
    marketplaceSplit: (r.marketplaceSplit as Record<string, number>) ?? undefined,
  }));

  // Calculate monthly capacities
  const monthCapacities: MonthCapacity[] = months.map(m => ({
    month: m.month,
    workingDays: m.workingDays,
    desiPerDay: m.desiPerDay,
    totalDesi: m.workingDays * m.desiPerDay,
    weight: 0,
  }));

  // Run allocator
  const allocations = allocateReserves(reserveInputs, monthCapacities);
  const summary = summarizeByMonth(allocations);

  // Build quota info for each month
  const monthQuotas = months.map(m => ({
    month: m.month,
    workingDays: m.workingDays,
    desiPerDay: m.desiPerDay,
    quotaDesi: m.workingDays * m.desiPerDay,
  }));

  if (!approve) {
    // Preview only — return without saving
    return NextResponse.json({
      success: true,
      data: {
        preview: true,
        allocations,
        summary,
        monthQuotas,
        totalProducts: pool.reserves.length,
        totalUnits: reserveInputs.reduce((s, r) => s + r.targetQuantity, 0),
      },
    });
  }

  // Approve — save allocations to DB
  const reserveMap = new Map(pool.reserves.map(r => [r.iwasku, r.id]));

  await prisma.$transaction(async (tx) => {
    // Delete existing allocations for this pool
    const reserveIds = pool.reserves.map(r => r.id);
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

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'BULK_UPLOAD', entityType: 'StockPool', entityId: id,
    description: `Aylık dağılım onaylandı: ${allocations.length} kayıt, ${summary.length} ay`,
    metadata: { allocationCount: allocations.length, monthCount: summary.length },
  });

  return NextResponse.json({
    success: true,
    data: {
      preview: false,
      approved: true,
      allocationsCreated: allocations.length,
      summary,
      monthQuotas,
    },
  });
}
