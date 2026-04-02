/**
 * Seasonal demand allocation algorithm
 *
 * monthShare = month_quota / total_demand → her ay %99+ kota
 * Min 15 consolidation: ROTASYONLU ay seçimi (farklı ürünler farklı aylar)
 * Kategori bazlı bağımsız dağıtım (her kategori = ayrı üretim bandı)
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
  month: string; // "2026-04"
  workingDays: number;
  desiPerDay: number;
  totalDesi: number;
  weight: number; // 0-1, proportion of total capacity
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
// Month shares: ay_kotası / toplam_talep
// ============================================

function calculateMonthShares(
  months: MonthCapacity[],
  totalDemandDesi: number,
): number[] {
  if (totalDemandDesi <= 0) {
    return months.map(() => 1 / months.length);
  }
  return months.map(m => m.totalDesi / totalDemandDesi);
}

// ============================================
// Evenly spaced month selection with rotation
// ============================================

/**
 * Select `numNeeded` months from `totalMonths`, evenly spaced with rotation offset.
 * Different offsets produce different month subsets → load balancing.
 *
 * Example: 8 months, need 5, offset=0 → [0,1,3,5,6]
 *          8 months, need 5, offset=1 → [1,2,4,6,7]
 *          8 months, need 5, offset=2 → [0,2,3,5,7]
 */
function selectMonths(totalMonths: number, numNeeded: number, offset: number): number[] {
  if (numNeeded >= totalMonths) {
    return Array.from({ length: totalMonths }, (_, i) => i);
  }
  if (numNeeded <= 0) return [];

  const spacing = totalMonths / numNeeded;
  const indices = new Set<number>();

  for (let i = 0; i < numNeeded; i++) {
    const idx = Math.floor((offset + i * spacing) % totalMonths);
    indices.add(idx);
  }

  // If set collisions reduced count, fill gaps
  if (indices.size < numNeeded) {
    for (let i = 0; i < totalMonths && indices.size < numNeeded; i++) {
      indices.add((offset + i) % totalMonths);
    }
  }

  return [...indices].sort((a, b) => a - b);
}

// ============================================
// Proportional distribution with largest remainder
// ============================================

function distributeProportional(
  targetQty: number,
  monthIndices: number[],
  shares: number[],
): { monthIdx: number; qty: number }[] {
  if (monthIndices.length === 0 || targetQty <= 0) return [];

  // Get shares for selected months, normalize
  const selectedShares = monthIndices.map(i => shares[i]!);
  const totalShare = selectedShares.reduce((s, w) => s + w, 0);

  if (totalShare === 0) {
    // Equal fallback
    const perMonth = Math.floor(targetQty / monthIndices.length);
    const remainder = targetQty - perMonth * monthIndices.length;
    return monthIndices.map((idx, i) => ({
      monthIdx: idx,
      qty: perMonth + (i < remainder ? 1 : 0),
    }));
  }

  // Proportional with largest remainder rounding
  const allocations = monthIndices.map((idx, j) => ({
    monthIdx: idx,
    raw: targetQty * (selectedShares[j]! / totalShare),
    qty: 0,
    remainder: 0,
  }));

  for (const a of allocations) {
    a.qty = Math.floor(a.raw);
    a.remainder = a.raw - a.qty;
  }

  const distributed = allocations.reduce((s, a) => s + a.qty, 0);
  const remaining = targetQty - distributed;
  const byRemainder = [...allocations].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < remaining && i < byRemainder.length; i++) {
    byRemainder[i]!.qty += 1;
  }

  return allocations.filter(a => a.qty > 0);
}

// ============================================
// MAIN: Allocate all reserves across months
// ============================================

export function allocateReserves(
  reserves: ReserveInput[],
  months: MonthCapacity[],
): AllocationResult[] {
  const weightedMonths = calculateMonthWeights(months);
  const allMonthCodes = weightedMonths.map(m => m.month);
  const totalMonths = allMonthCodes.length;

  // Total demand desi
  const totalDemandDesi = reserves.reduce(
    (s, r) => s + r.targetQuantity * r.desiPerUnit, 0
  );

  // Month shares: ay_kotası / toplam_talep
  const shares = calculateMonthShares(weightedMonths, totalDemandDesi);

  // Group reserves by category
  const byCategory = new Map<string, ReserveInput[]>();
  for (const reserve of reserves) {
    const cat = reserve.category || '_uncategorized';
    const group = byCategory.get(cat) ?? [];
    group.push(reserve);
    byCategory.set(cat, group);
  }

  const results: AllocationResult[] = [];

  for (const [, categoryReserves] of Array.from(byCategory)) {
    // Sort by total desi descending
    const sorted = [...categoryReserves].sort(
      (a, b) => (b.targetQuantity * b.desiPerUnit) - (a.targetQuantity * a.desiPerUnit)
    );

    for (let productIdx = 0; productIdx < sorted.length; productIdx++) {
      const reserve = sorted[productIdx]!;
      const minBatch = getMinBatchSize(reserve.desiPerUnit);

      // Check if product fits in all months with min 15
      const idealPerMonth = shares.map(s => reserve.targetQuantity * s);
      const allAboveMin = idealPerMonth.every(q => q >= minBatch || q === 0);

      let selectedIndices: number[];

      if (allAboveMin) {
        // All months qualify → use all
        selectedIndices = Array.from({ length: totalMonths }, (_, i) => i);
      } else if (reserve.targetQuantity < minBatch) {
        // Total below min → single month (rotated)
        selectedIndices = [productIdx % totalMonths];
      } else {
        // Need fewer months — calculate how many
        const numMonths = Math.min(
          totalMonths,
          Math.max(1, Math.floor(reserve.targetQuantity / minBatch))
        );
        // Rotated even spacing
        selectedIndices = selectMonths(totalMonths, numMonths, productIdx % numMonths);
      }

      // Distribute across selected months proportionally
      const distributed = distributeProportional(
        reserve.targetQuantity,
        selectedIndices,
        shares,
      );

      for (const d of distributed) {
        results.push({
          iwasku: reserve.iwasku,
          month: allMonthCodes[d.monthIdx]!,
          plannedQty: d.qty,
          plannedDesi: Math.round(d.qty * reserve.desiPerUnit * 10) / 10,
        });
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
