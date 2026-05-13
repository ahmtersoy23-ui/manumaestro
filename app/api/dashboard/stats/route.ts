/**
 * Dashboard Stats API
 * GET: Returns aggregated stats for multiple production months in a single query
 * Replaces N+1 calls to /api/requests/monthly from the dashboard page
 */

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { enrichProductSize } from '@/lib/db/enrichProductSize';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

/**
 * Hesaplanmış stats'i 5dk cache'le. Tag: 'dashboard-stats'.
 * ProductionRequest / MonthSnapshot mutate eden route'larda
 * revalidateTag('dashboard-stats') ile invalid edilir.
 *
 * Months array'i input cache key'inin parçası — farklı ay seçimleri
 * ayrı cache slot'larında.
 */
const computeStats = unstable_cache(
  async (months: string[]) => {
    const requests = await prisma.productionRequest.findMany({
      where: { productionMonth: { in: months } },
      select: {
        iwasku: true,
        productCategory: true,
        productSize: true,
        quantity: true,
        producedQuantity: true,
        productionMonth: true,
      },
    });

    await enrichProductSize(requests);

    const statsMap = new Map<string, {
      totalRequests: number;
      totalQuantity: number;
      totalDesi: number;
      itemsWithoutSize: number;
      productMap: Map<string, { producedQty: number; productSize: number }>;
    }>();

    for (const month of months) {
      statsMap.set(month, {
        totalRequests: 0,
        totalQuantity: 0,
        totalDesi: 0,
        itemsWithoutSize: 0,
        productMap: new Map(),
      });
    }

    const allSnapshots = await prisma.monthSnapshot.findMany({
      where: { month: { in: months } },
      select: { month: true, iwasku: true, produced: true },
    });
    const snapshotProducedMap = new Map<string, number>();
    for (const s of allSnapshots) {
      snapshotProducedMap.set(`${s.month}|${s.iwasku}`, s.produced);
    }

    for (const r of requests) {
      const entry = statsMap.get(r.productionMonth)!;
      entry.totalRequests += 1;
      entry.totalQuantity += r.quantity;
      entry.totalDesi += (r.productSize || 0) * r.quantity;
      if (!r.productSize) entry.itemsWithoutSize += 1;

      const existing = entry.productMap.get(r.iwasku);
      if (!existing) {
        entry.productMap.set(r.iwasku, {
          producedQty: snapshotProducedMap.get(`${r.productionMonth}|${r.iwasku}`) ?? 0,
          productSize: r.productSize || 0,
        });
      }
    }

    return months.map(month => {
      const entry = statsMap.get(month)!;
      let totalProduced = 0;
      let totalProducedDesi = 0;
      for (const product of entry.productMap.values()) {
        totalProduced += product.producedQty;
        totalProducedDesi += product.productSize * product.producedQty;
      }
      return {
        month,
        totalRequests: entry.totalRequests,
        totalQuantity: entry.totalQuantity,
        totalProduced,
        totalDesi: entry.totalDesi,
        totalProducedDesi,
        itemsWithoutSize: entry.itemsWithoutSize,
      };
    });
  },
  ['dashboard-stats'],
  { tags: ['dashboard-stats'], revalidate: 300 },
);

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Panel istatistikleri getirilemedi' },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const monthsParam = searchParams.get('months');

    if (!monthsParam) {
      return NextResponse.json(
        { success: false, error: 'months parametresi gereklidir (virgülle ayrılmış YYYY-MM değerleri)' },
        { status: 400 }
      );
    }

    // Validate and parse months
    const monthRegex = /^\d{4}-\d{2}$/;
    const months = monthsParam.split(',').filter(m => monthRegex.test(m.trim())).map(m => m.trim());

    if (months.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Geçerli ay bulunamadı. Beklenen format: YYYY-MM' },
        { status: 400 }
      );
    }

    // Cap to prevent abuse
    if (months.length > 24) {
      return NextResponse.json(
        { success: false, error: 'İstek başına en fazla 24 ay izin verilir' },
        { status: 400 }
      );
    }

    // Sort months for cache key stability (aynı set farklı sıralarda
    // gelmiş olsa da cache hit olsun)
    const sortedMonths = [...months].sort();
    const result = await computeStats(sortedMonths);

    return successResponse(result);
  }
);
