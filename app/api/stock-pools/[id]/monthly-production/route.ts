/**
 * Monthly Production Tracking API
 * GET: Aggregate weekly warehouse entries by month for seasonal pool products
 *
 * Returns per-month production vs planned allocation comparison
 * Week boundary rule: weekStart month determines which month the production counts for
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;
  const { id } = await params;

  const pool = await prisma.stockPool.findUnique({
    where: { id },
    include: {
      reserves: {
        where: { status: { not: 'CANCELLED' } },
        select: { iwasku: true, targetQuantity: true, initialStock: true },
        orderBy: { targetQuantity: 'desc' },
      },
    },
  });

  if (!pool) {
    return NextResponse.json({ success: false, error: 'Havuz bulunamadı' }, { status: 404 });
  }

  const iwaskus = pool.reserves.map(r => r.iwasku);
  if (iwaskus.length === 0) {
    return NextResponse.json({ success: true, data: { months: [], byProduct: [] } });
  }

  // Get all PRODUCTION weekly entries for these iwaskus
  const weeklyEntries = await prisma.warehouseWeekly.findMany({
    where: {
      iwasku: { in: iwaskus },
      type: 'PRODUCTION',
      quantity: { gt: 0 },
    },
    select: {
      iwasku: true,
      weekStart: true,
      quantity: true,
    },
    orderBy: { weekStart: 'asc' },
  });

  // Get planned allocations per month per product
  const allocations = await prisma.monthlyAllocation.findMany({
    where: {
      reserve: { poolId: id, status: { not: 'CANCELLED' } },
    },
    select: {
      month: true,
      plannedQty: true,
      reserve: { select: { iwasku: true } },
    },
  });

  // Aggregate weekly entries by month
  // weekStart month = which month this production counts for
  const productionByMonth = new Map<string, Map<string, number>>(); // month -> iwasku -> qty

  for (const entry of weeklyEntries) {
    const d = new Date(entry.weekStart);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    if (!productionByMonth.has(month)) productionByMonth.set(month, new Map());
    const monthMap = productionByMonth.get(month)!;
    monthMap.set(entry.iwasku, (monthMap.get(entry.iwasku) ?? 0) + entry.quantity);
  }

  // Aggregate planned allocations by month
  const plannedByMonth = new Map<string, Map<string, number>>(); // month -> iwasku -> qty

  for (const alloc of allocations) {
    const month = alloc.month;
    if (!plannedByMonth.has(month)) plannedByMonth.set(month, new Map());
    const monthMap = plannedByMonth.get(month)!;
    monthMap.set(alloc.reserve.iwasku, (monthMap.get(alloc.reserve.iwasku) ?? 0) + alloc.plannedQty);
  }

  // Collect all months
  const allMonths = new Set([...productionByMonth.keys(), ...plannedByMonth.keys()]);
  const sortedMonths = Array.from(allMonths).sort();

  // Build month summary
  const months = sortedMonths.map(month => {
    const produced = productionByMonth.get(month);
    const planned = plannedByMonth.get(month);

    const totalProduced = produced ? Array.from(produced.values()).reduce((s, v) => s + v, 0) : 0;
    const totalPlanned = planned ? Array.from(planned.values()).reduce((s, v) => s + v, 0) : 0;
    const productCount = produced ? produced.size : 0;

    return {
      month,
      totalPlanned,
      totalProduced,
      diff: totalProduced - totalPlanned,
      productCount,
    };
  });

  // Build per-product per-month detail
  const byProduct = sortedMonths.map(month => {
    const produced = productionByMonth.get(month) ?? new Map<string, number>();
    const planned = plannedByMonth.get(month) ?? new Map<string, number>();

    const productKeys = new Set([...produced.keys(), ...planned.keys()]);
    const products = Array.from(productKeys).map(iwasku => ({
      iwasku,
      planned: planned.get(iwasku) ?? 0,
      produced: produced.get(iwasku) ?? 0,
    })).sort((a, b) => b.planned - a.planned);

    return { month, products };
  });

  return NextResponse.json({
    success: true,
    data: { months, byProduct },
  });
}
