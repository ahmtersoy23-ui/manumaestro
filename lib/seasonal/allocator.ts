/**
 * Seasonal demand allocation — Waterfall Fill
 *
 * Ayları sırayla doldurur: Nisan→Kasım. Her ay kotasına kadar dolar.
 * Talep bitince kalan aylar boş kalır. Yeni listeler gelince yeniden hesaplanır.
 *
 * Her kategoride aynı oranda ilerleme (eşit dağılım).
 * Ürünler büyükten küçüğe, min 15 batch.
 */

import { getMinBatchSize } from './config';

// ============================================
// TYPES
// ============================================

export interface ReserveInput {
  iwasku: string;
  targetQuantity: number;
  desiPerUnit: number;
  category: string;
  marketplaceSplit?: Record<string, number>;
}

export interface MonthCapacity {
  month: string;
  workingDays: number;
  desiPerDay: number;
  totalDesi: number;
  weight: number;
}

export interface AllocationResult {
  iwasku: string;
  month: string;
  plannedQty: number;
  plannedDesi: number;
}

// ============================================
// Monthly capacity weights
// ============================================

export function calculateMonthWeights(months: MonthCapacity[]): MonthCapacity[] {
  const totalDesi = months.reduce((sum, m) => sum + m.totalDesi, 0);
  return months.map(m => ({
    ...m,
    weight: totalDesi > 0 ? m.totalDesi / totalDesi : 1 / months.length,
  }));
}

// ============================================
// MAIN: Waterfall allocation
// ============================================

export function allocateReserves(
  reserves: ReserveInput[],
  months: MonthCapacity[],
): AllocationResult[] {
  const totalDemandDesi = reserves.reduce(
    (s, r) => s + r.targetQuantity * r.desiPerUnit, 0
  );
  if (totalDemandDesi <= 0 || months.length === 0) return [];

  // Group by category
  const byCategory = new Map<string, ReserveInput[]>();
  for (const reserve of reserves) {
    const cat = reserve.category || '_uncategorized';
    const group = byCategory.get(cat) ?? [];
    group.push(reserve);
    byCategory.set(cat, group);
  }

  // Calculate each category's share of total demand
  const catDesiMap = new Map<string, number>();
  for (const [cat, catReserves] of Array.from(byCategory)) {
    const catDesi = catReserves.reduce((s, r) => s + r.targetQuantity * r.desiPerUnit, 0);
    catDesiMap.set(cat, catDesi);
  }

  const results: AllocationResult[] = [];

  // Process each category independently (each has its own production line)
  for (const [cat, catReserves] of Array.from(byCategory)) {
    const catTotalDesi = catDesiMap.get(cat)!;
    const catShare = catTotalDesi / totalDemandDesi;

    // Sort by desi descending — large products first for stable allocation
    const sorted = [...catReserves].sort(
      (a, b) => (b.targetQuantity * b.desiPerUnit) - (a.targetQuantity * a.desiPerUnit)
    );

    // Track remaining qty per product
    const remaining = new Map<string, number>();
    for (const r of sorted) remaining.set(r.iwasku, r.targetQuantity);

    let catRemainingDesi = catTotalDesi;

    // Waterfall: fill months in order
    for (const month of months) {
      if (catRemainingDesi <= 0) break;

      // This category's quota for this month
      const monthCatQuota = month.totalDesi * catShare;

      // Share of remaining to allocate this month
      const share = Math.min(1, monthCatQuota / catRemainingDesi);

      let monthAllocDesi = 0;

      for (const reserve of sorted) {
        const remQty = remaining.get(reserve.iwasku)!;
        if (remQty <= 0) continue;

        const minBatch = getMinBatchSize(reserve.desiPerUnit);
        const idealQty = Math.round(remQty * share);

        if (idealQty >= minBatch) {
          // Normal allocation
          results.push({
            iwasku: reserve.iwasku,
            month: month.month,
            plannedQty: idealQty,
            plannedDesi: Math.round(idealQty * reserve.desiPerUnit * 10) / 10,
          });
          remaining.set(reserve.iwasku, remQty - idealQty);
          monthAllocDesi += idealQty * reserve.desiPerUnit;
        } else if (remQty <= minBatch) {
          // Remaining is small — dump all here
          results.push({
            iwasku: reserve.iwasku,
            month: month.month,
            plannedQty: remQty,
            plannedDesi: Math.round(remQty * reserve.desiPerUnit * 10) / 10,
          });
          remaining.set(reserve.iwasku, 0);
          monthAllocDesi += remQty * reserve.desiPerUnit;
        }
        // else: skip — will be allocated in a later month where share is higher
      }

      catRemainingDesi -= monthAllocDesi;
    }

    // Safety: any remaining goes to last month
    const lastMonth = months[months.length - 1]!;
    for (const reserve of sorted) {
      const remQty = remaining.get(reserve.iwasku)!;
      if (remQty > 0) {
        results.push({
          iwasku: reserve.iwasku,
          month: lastMonth.month,
          plannedQty: remQty,
          plannedDesi: Math.round(remQty * reserve.desiPerUnit * 10) / 10,
        });
        remaining.set(reserve.iwasku, 0);
      }
    }
  }

  return results;
}

// ============================================
// HELPER: Summarize allocations by month
// ============================================

export function summarizeByMonth(
  allocations: AllocationResult[],
): { month: string; totalQty: number; totalDesi: number; productCount: number }[] {
  const map = new Map<string, { totalQty: number; totalDesi: number; products: Set<string> }>();

  for (const a of allocations) {
    const existing = map.get(a.month) ?? { totalQty: 0, totalDesi: 0, products: new Set<string>() };
    existing.totalQty += a.plannedQty;
    existing.totalDesi += a.plannedDesi;
    existing.products.add(a.iwasku);
    map.set(a.month, existing);
  }

  return Array.from(map.entries())
    .map(([month, data]) => ({
      month,
      totalQty: data.totalQty,
      totalDesi: Math.round(data.totalDesi * 10) / 10,
      productCount: data.products.size,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
