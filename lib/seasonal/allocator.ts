/**
 * Seasonal demand allocation algorithm — capacity-aware
 *
 * Distributes total seasonal demand across months, respecting:
 * 1. Monthly capacity quotas (each month has a desi limit)
 * 2. Category independence (each category = separate production line)
 * 3. Lead time weight shifting (AU/US → early months, EU/UK → late months)
 * 4. Minimum batch size (15 units per product per month)
 * 5. Proportional distribution across products (risk mitigation)
 * 6. Capacity balancing (no month exceeds its quota disproportionately)
 */

import {
  getMinBatchSize,
  getLeadTimeFactor,
  LEAD_TIME_SHIFT_STRENGTH,
} from './config';

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
// STEP 1: Monthly capacity weights
// ============================================

export function calculateMonthWeights(months: MonthCapacity[]): MonthCapacity[] {
  const totalDesi = months.reduce((sum, m) => sum + m.totalDesi, 0);
  return months.map(m => ({
    ...m,
    weight: totalDesi > 0 ? m.totalDesi / totalDesi : 1 / months.length,
  }));
}

// ============================================
// STEP 2: Lead time weight adjustment
// ============================================

function adjustWeightsForLeadTime(
  baseWeights: number[],
  leadFactor: number,
  strength: number,
): number[] {
  const n = baseWeights.length;
  if (n <= 1) return [...baseWeights];

  const adjusted = baseWeights.map((w, i) => {
    const monthPosition = i / (n - 1); // 0.0 (first) → 1.0 (last)
    const earlyBias = (1 - monthPosition) * leadFactor;
    const lateBias = monthPosition * (1 - leadFactor);
    const shift = 1 + strength * (earlyBias - lateBias);
    return w * Math.max(0.01, shift);
  });

  const total = adjusted.reduce((s, w) => s + w, 0);
  return total > 0 ? adjusted.map(w => w / total) : baseWeights;
}

// ============================================
// STEP 3: Capacity-aware weight adjustment
// ============================================

/**
 * Adjusts month weights based on remaining capacity.
 * Months that are nearly full get lower weight,
 * months with lots of remaining capacity get higher weight.
 */
function adjustWeightsForCapacity(
  weights: number[],
  remainingCapacity: number[],
  totalCapacity: number[],
): number[] {
  const adjusted = weights.map((w, i) => {
    const remaining = remainingCapacity[i]!;
    const total = totalCapacity[i]!;
    if (total <= 0) return 0;
    // Scale weight by how much capacity remains (0 = full, 1 = empty)
    const capacityRatio = Math.max(0, remaining / total);
    // Smooth scaling: full months get near-zero weight, empty months keep full weight
    return w * capacityRatio;
  });

  const sum = adjusted.reduce((s, w) => s + w, 0);
  return sum > 0 ? adjusted.map(w => w / sum) : weights;
}

// ============================================
// STEP 4: Distribute single product to months
// ============================================

function distributeProduct(
  targetQty: number,
  desiPerUnit: number,
  allMonths: string[],
  adjustedWeights: number[],
  minBatch: number,
): { month: string; qty: number }[] {
  if (allMonths.length === 0 || targetQty <= 0) return [];

  // Special case: total below minimum → all in highest-weight month
  if (targetQty < minBatch) {
    const bestIdx = adjustedWeights.indexOf(Math.max(...adjustedWeights));
    return [{ month: allMonths[bestIdx]!, qty: targetQty }];
  }

  // Iterative min-batch enforcement
  let activeMonths = allMonths.map((m, i) => ({ month: m, weight: adjustedWeights[i]! }));

  for (let iteration = 0; iteration < allMonths.length; iteration++) {
    const totalWeight = activeMonths.reduce((s, m) => s + m.weight, 0);
    if (totalWeight === 0 || activeMonths.length === 0) break;

    // Proportional allocation with largest remainder
    const rawAllocations = activeMonths.map(m => ({
      month: m.month,
      raw: targetQty * (m.weight / totalWeight),
      floored: 0,
      remainder: 0,
    }));

    for (const a of rawAllocations) {
      a.floored = Math.floor(a.raw);
      a.remainder = a.raw - a.floored;
    }

    const distributed = rawAllocations.reduce((s, a) => s + a.floored, 0);
    const remaining = targetQty - distributed;
    const byRemainder = [...rawAllocations].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < remaining && i < byRemainder.length; i++) {
      byRemainder[i]!.floored += 1;
    }

    // Check min batch
    const belowMin = rawAllocations.filter(a => a.floored > 0 && a.floored < minBatch);

    if (belowMin.length === 0) {
      return rawAllocations
        .map(a => ({ month: a.month, qty: a.floored }))
        .filter(r => r.qty > 0);
    }

    // Remove below-min months and retry
    const belowMonths = new Set(belowMin.map(a => a.month));
    activeMonths = activeMonths.filter(m => !belowMonths.has(m.month));

    if (activeMonths.length <= 1) {
      if (activeMonths.length === 1) {
        return [{ month: activeMonths[0]!.month, qty: targetQty }];
      }
      return [{ month: allMonths[0]!, qty: targetQty }];
    }
  }

  const bestIdx = adjustedWeights.indexOf(Math.max(...adjustedWeights));
  return [{ month: allMonths[bestIdx]!, qty: targetQty }];
}

// ============================================
// MAIN: Capacity-aware allocation
// ============================================

export function allocateReserves(
  reserves: ReserveInput[],
  months: MonthCapacity[],
): AllocationResult[] {
  const weightedMonths = calculateMonthWeights(months);
  const baseWeights = weightedMonths.map(m => m.weight);
  const allMonthCodes = weightedMonths.map(m => m.month);
  const totalCapacity = weightedMonths.map(m => m.totalDesi);
  const remainingCapacity = [...totalCapacity];

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
    // Sort by total desi descending — large products first for stable allocation
    const sorted = [...categoryReserves].sort(
      (a, b) => (b.targetQuantity * b.desiPerUnit) - (a.targetQuantity * a.desiPerUnit)
    );

    for (const reserve of sorted) {
      const minBatch = getMinBatchSize(reserve.desiPerUnit);

      // Lead time factor from marketplace split
      const leadFactor = reserve.marketplaceSplit
        ? getLeadTimeFactor(reserve.marketplaceSplit)
        : 0.3;

      // Base weights adjusted for lead time
      const leadAdjusted = adjustWeightsForLeadTime(
        baseWeights,
        leadFactor,
        LEAD_TIME_SHIFT_STRENGTH,
      );

      // Further adjust for remaining capacity — avoids overloading months
      const capacityAdjusted = adjustWeightsForCapacity(
        leadAdjusted,
        remainingCapacity,
        totalCapacity,
      );

      // Distribute this product
      const monthlyQtys = distributeProduct(
        reserve.targetQuantity,
        reserve.desiPerUnit,
        allMonthCodes,
        capacityAdjusted,
        minBatch,
      );

      // Record results and deduct from remaining capacity
      for (const mq of monthlyQtys) {
        const allocDesi = mq.qty * reserve.desiPerUnit;
        results.push({
          iwasku: reserve.iwasku,
          month: mq.month,
          plannedQty: mq.qty,
          plannedDesi: Math.round(allocDesi * 10) / 10,
        });

        // Deduct from remaining capacity
        const monthIdx = allMonthCodes.indexOf(mq.month);
        if (monthIdx >= 0) {
          remainingCapacity[monthIdx] = Math.max(0, remainingCapacity[monthIdx]! - allocDesi);
        }
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
