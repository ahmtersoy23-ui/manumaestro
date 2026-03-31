/**
 * Seasonal demand allocation algorithm
 *
 * Distributes total seasonal demand across months, respecting:
 * 1. Monthly capacity weights (working days × desi/day)
 * 2. Category balance (each category gets proportional share)
 * 3. ABC classification (A=monthly, B=bimonthly, C=quarterly)
 * 4. Minimum batch sizes (desi-based tiers)
 * 5. Lead time prioritization (AU first, EU/UK last)
 * 6. Largest remainder rounding
 */

import {
  getMinBatchSize,
  getABCClass,
  ABC_FREQUENCY,
  getLeadTimePriority,
  type ABCClass,
} from './config';

// ============================================
// TYPES
// ============================================

export interface ReserveInput {
  iwasku: string;
  targetQuantity: number;
  desiPerUnit: number;
  category: string;
  destination?: string;
  /** Revenue for ABC classification (higher = A class) */
  revenue?: number;
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
// STEP 2-3: ABC classification
// ============================================

function classifyABC(reserves: ReserveInput[]): Map<string, ABCClass> {
  // Sort by revenue descending
  const sorted = [...reserves]
    .filter(r => (r.revenue ?? 0) > 0)
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));

  const totalRevenue = sorted.reduce((sum, r) => sum + (r.revenue ?? 0), 0);
  if (totalRevenue === 0) {
    // No revenue data — treat all as B
    return new Map(reserves.map(r => [r.iwasku, 'B' as ABCClass]));
  }

  const result = new Map<string, ABCClass>();
  let cumulative = 0;

  for (const r of sorted) {
    cumulative += (r.revenue ?? 0);
    result.set(r.iwasku, getABCClass(cumulative / totalRevenue));
  }

  // Products without revenue data → C class
  for (const r of reserves) {
    if (!result.has(r.iwasku)) {
      result.set(r.iwasku, 'C');
    }
  }

  return result;
}

// ============================================
// STEP 4: Determine production months per product
// ============================================

function getProductionMonths(
  abcClass: ABCClass,
  allMonths: string[],
  destination?: string,
): string[] {
  const frequency = ABC_FREQUENCY[abcClass];
  const leadPriority = destination ? getLeadTimePriority(destination) : 0.5;

  if (frequency === 1) {
    // A class: every month
    return [...allMonths];
  }

  // B/C: select months at intervals
  // For high lead-time destinations, prefer earlier months
  const selected: string[] = [];
  const startOffset = leadPriority > 0.5 ? 0 : frequency === 2 ? 1 : 2;

  for (let i = startOffset; i < allMonths.length; i += frequency) {
    selected.push(allMonths[i]!);
  }

  // Ensure at least one month
  if (selected.length === 0 && allMonths.length > 0) {
    selected.push(allMonths[0]!);
  }

  return selected;
}

// ============================================
// STEP 5-6: Proportional distribution + rounding
// ============================================

function distributeToMonths(
  targetQty: number,
  desiPerUnit: number,
  productionMonths: string[],
  monthWeights: Map<string, number>,
  minBatch: number,
): { month: string; qty: number }[] {
  if (productionMonths.length === 0 || targetQty <= 0) return [];

  // Calculate weights for selected months only
  const selectedWeights = productionMonths.map(m => monthWeights.get(m) ?? 0);
  const totalWeight = selectedWeights.reduce((s, w) => s + w, 0);

  if (totalWeight === 0) {
    // Equal distribution fallback
    const perMonth = Math.floor(targetQty / productionMonths.length);
    const remainder = targetQty - perMonth * productionMonths.length;
    return productionMonths.map((m, i) => ({
      month: m,
      qty: perMonth + (i < remainder ? 1 : 0),
    }));
  }

  // Proportional allocation with largest remainder method
  const rawAllocations = productionMonths.map((m, i) => ({
    month: m,
    raw: (targetQty * (selectedWeights[i]! / totalWeight)),
    floored: 0,
    remainder: 0,
  }));

  // Floor all values
  for (const a of rawAllocations) {
    a.floored = Math.floor(a.raw);
    a.remainder = a.raw - a.floored;
  }

  // Distribute remaining units by largest remainder
  const distributed = rawAllocations.reduce((s, a) => s + a.floored, 0);
  const remaining = targetQty - distributed;

  // Sort by remainder descending for distribution
  const byRemainder = [...rawAllocations].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < remaining && i < byRemainder.length; i++) {
    byRemainder[i]!.floored += 1;
  }

  // Apply minimum batch rule
  // If a month's allocation is below minimum, redistribute to other months
  const result: { month: string; qty: number }[] = [];
  let redistributeQty = 0;
  const validMonths: typeof rawAllocations = [];

  for (const a of rawAllocations) {
    if (a.floored > 0 && a.floored < minBatch) {
      // Below minimum — don't produce this month
      redistributeQty += a.floored;
    } else {
      validMonths.push(a);
      result.push({ month: a.month, qty: a.floored });
    }
  }

  // Redistribute collected quantities to valid months (proportionally)
  if (redistributeQty > 0 && validMonths.length > 0) {
    const validTotal = validMonths.reduce((s, a) => s + a.floored, 0);
    let leftover = redistributeQty;

    for (let i = 0; i < result.length && leftover > 0; i++) {
      const share = validTotal > 0
        ? Math.round(redistributeQty * (result[i]!.qty / validTotal))
        : Math.round(redistributeQty / result.length);
      const add = Math.min(share, leftover);
      result[i]!.qty += add;
      leftover -= add;
    }

    // Any remaining goes to the first month
    if (leftover > 0 && result.length > 0) {
      result[0]!.qty += leftover;
    }
  }

  // If total qty is below minimum for a single batch, put it all in one month
  if (targetQty > 0 && targetQty < minBatch && result.length === 0) {
    // Round up to minimum
    return [{ month: productionMonths[0]!, qty: minBatch }];
  }

  return result.filter(r => r.qty > 0);
}

// ============================================
// MAIN: Allocate all reserves across months
// ============================================

export function allocateReserves(
  reserves: ReserveInput[],
  months: MonthCapacity[],
): AllocationResult[] {
  const weightedMonths = calculateMonthWeights(months);
  const monthWeightMap = new Map(weightedMonths.map(m => [m.month, m.weight]));
  const allMonthCodes = weightedMonths.map(m => m.month);
  const abcMap = classifyABC(reserves);

  const results: AllocationResult[] = [];

  for (const reserve of reserves) {
    const abcClass = abcMap.get(reserve.iwasku) ?? 'B';
    const minBatch = getMinBatchSize(reserve.desiPerUnit);

    // Determine which months this product will be produced
    const prodMonths = getProductionMonths(
      abcClass,
      allMonthCodes,
      reserve.destination,
    );

    // Distribute target quantity across those months
    const monthlyQtys = distributeToMonths(
      reserve.targetQuantity,
      reserve.desiPerUnit,
      prodMonths,
      monthWeightMap,
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

  return [...map.entries()]
    .map(([month, data]) => ({
      month,
      totalQty: data.totalQty,
      totalDesi: Math.round(data.totalDesi * 10) / 10,
      productCount: data.products.size,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
