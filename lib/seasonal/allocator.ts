/**
 * Seasonal demand allocation algorithm
 *
 * Distributes total seasonal demand across months, respecting:
 * 1. Monthly capacity weights (working days × desi/day)
 * 2. Category independence (each category = separate production line)
 * 3. Lead time weight shifting (AU/US → early months, EU/UK → late months)
 * 4. Minimum batch size (15 units per product per month)
 * 5. Proportional distribution across products (risk mitigation)
 * 6. Largest remainder rounding
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

/**
 * Shifts month weights based on lead time factor.
 * High lead time (AU) → earlier months get more weight.
 * Low lead time (EU) → later months get more weight.
 */
function adjustWeightsForLeadTime(
  baseWeights: number[],
  leadFactor: number,
  strength: number,
): number[] {
  const n = baseWeights.length;
  if (n <= 1) return [...baseWeights];

  const adjusted = baseWeights.map((w, i) => {
    const monthPosition = i / (n - 1); // 0.0 (first) → 1.0 (last)
    // leadFactor=1.0 (AU) → early months boosted, late reduced
    // leadFactor=0.0 (EU) → late months boosted, early reduced
    const earlyBias = (1 - monthPosition) * leadFactor;
    const lateBias = monthPosition * (1 - leadFactor);
    const shift = 1 + strength * (earlyBias - lateBias);
    return w * Math.max(0.01, shift);
  });

  // Normalize so weights sum to 1.0
  const total = adjusted.reduce((s, w) => s + w, 0);
  return total > 0 ? adjusted.map(w => w / total) : baseWeights;
}

// ============================================
// STEP 3: Proportional distribution + rounding
// ============================================

function distributeToMonths(
  targetQty: number,
  allMonths: string[],
  adjustedWeights: number[],
  minBatch: number,
): { month: string; qty: number }[] {
  if (allMonths.length === 0 || targetQty <= 0) return [];

  // Special case: total below minimum → all in highest-weight month, no rounding up
  if (targetQty < minBatch) {
    const bestIdx = adjustedWeights.indexOf(Math.max(...adjustedWeights));
    return [{ month: allMonths[bestIdx]!, qty: targetQty }];
  }

  // Iterative min-batch enforcement:
  // Distribute proportionally, then remove months below min batch, repeat
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

    // Distribute remaining units by largest remainder
    const distributed = rawAllocations.reduce((s, a) => s + a.floored, 0);
    const remaining = targetQty - distributed;
    const byRemainder = [...rawAllocations].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < remaining && i < byRemainder.length; i++) {
      byRemainder[i]!.floored += 1;
    }

    // Check min batch — find months below threshold
    const belowMin = rawAllocations.filter(a => a.floored > 0 && a.floored < minBatch);

    if (belowMin.length === 0) {
      // All months meet minimum — done
      return rawAllocations
        .map(a => ({ month: a.month, qty: a.floored }))
        .filter(r => r.qty > 0);
    }

    // Remove below-min months and retry
    const belowMonths = new Set(belowMin.map(a => a.month));
    activeMonths = activeMonths.filter(m => !belowMonths.has(m.month));

    // If only one month left (or none), put everything there
    if (activeMonths.length <= 1) {
      if (activeMonths.length === 1) {
        return [{ month: activeMonths[0]!.month, qty: targetQty }];
      }
      // Fallback: first month
      return [{ month: allMonths[0]!, qty: targetQty }];
    }
  }

  // Fallback: shouldn't reach here, but put all in highest-weight month
  const bestIdx = adjustedWeights.indexOf(Math.max(...adjustedWeights));
  return [{ month: allMonths[bestIdx]!, qty: targetQty }];
}

// ============================================
// MAIN: Allocate all reserves across months
// ============================================

export function allocateReserves(
  reserves: ReserveInput[],
  months: MonthCapacity[],
): AllocationResult[] {
  const weightedMonths = calculateMonthWeights(months);
  const baseWeights = weightedMonths.map(m => m.weight);
  const allMonthCodes = weightedMonths.map(m => m.month);

  // Group reserves by category (each category = independent production line)
  const byCategory = new Map<string, ReserveInput[]>();
  for (const reserve of reserves) {
    const cat = reserve.category || '_uncategorized';
    const group = byCategory.get(cat) ?? [];
    group.push(reserve);
    byCategory.set(cat, group);
  }

  const results: AllocationResult[] = [];

  // Process each category independently
  for (const [, categoryReserves] of Array.from(byCategory)) {
    for (const reserve of categoryReserves) {
      const minBatch = getMinBatchSize(reserve.desiPerUnit);

      // Calculate lead time factor from marketplace split
      const leadFactor = reserve.marketplaceSplit
        ? getLeadTimeFactor(reserve.marketplaceSplit)
        : 0.3; // default: slightly toward early months

      // Adjust month weights for this product's lead time
      const adjusted = adjustWeightsForLeadTime(
        baseWeights,
        leadFactor,
        LEAD_TIME_SHIFT_STRENGTH,
      );

      // Distribute target quantity across months
      const monthlyQtys = distributeToMonths(
        reserve.targetQuantity,
        allMonthCodes,
        adjusted,
        minBatch,
      );

      for (const mq of monthlyQtys) {
        results.push({
          iwasku: reserve.iwasku,
          month: mq.month,
          plannedQty: mq.qty,
          plannedDesi: Math.round(mq.qty * reserve.desiPerUnit * 10) / 10,
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
