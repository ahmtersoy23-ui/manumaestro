/**
 * Seasonal demand allocation algorithm
 *
 * Rolling share: her ay için pay = ay_kotası / kalan_kapasite
 * Bu sayede toplam talep < toplam kapasite olsa bile her ay orantılı dolar.
 *
 * Kurallar:
 * 1. Kategori bazlı bağımsız dağıtım (her kategori = ayrı üretim bandı)
 * 2. Her kategoride tüm aylar aynı % ilerlemeli (eşit dağılım)
 * 3. Ürünler büyükten küçüğe, min 15 batch
 * 4. Lead time yumuşak kaydırma (AU/US erken, EU/UK geç)
 * 5. Ay kapasitesini aşma
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
// STEP 2: Rolling month shares
// ============================================

/**
 * Calculate month shares: ay_kotası / toplam_talep
 *
 * Her ürünün bu oranı kadar o aya yerleştirilir.
 * Toplam talep < toplam kapasite ise toplam üretim > toplam talep olur (kapasite doldurma).
 * Bu sayede her ay ~%99+ kota kullanımına ulaşır.
 *
 * Örnek: Nisan kotası=11,500, toplam talep=53,376
 *   share = 11,500/53,376 = 0.2155 → her ürünün %21.5'i Nisan'a
 *   Nisan toplam = 53,376 × 0.2155 = 11,500 desi (kota %100)
 */
function calculateMonthShares(
  months: MonthCapacity[],
  totalDemandDesi: number,
): number[] {
  if (totalDemandDesi <= 0) {
    const n = months.length;
    return months.map(() => 1 / n);
  }
  return months.map(m => m.totalDesi / totalDemandDesi);
}

// ============================================
// STEP 3: Lead time weight adjustment (mild)
// ============================================

function adjustWeightsForLeadTime(
  baseWeights: number[],
  leadFactor: number,
  strength: number,
): number[] {
  const n = baseWeights.length;
  if (n <= 1) return [...baseWeights];

  const adjusted = baseWeights.map((w, i) => {
    const monthPosition = i / (n - 1);
    const earlyBias = (1 - monthPosition) * leadFactor;
    const lateBias = monthPosition * (1 - leadFactor);
    const shift = 1 + strength * (earlyBias - lateBias);
    return w * Math.max(0.01, shift);
  });

  const total = adjusted.reduce((s, w) => s + w, 0);
  return total > 0 ? adjusted.map(w => w / total) : baseWeights;
}

// ============================================
// STEP 4: Distribute single product with min 15
// ============================================

/**
 * Distribute a product across months, enforcing min 15 batch.
 * Key fix: remove only the SMALLEST below-min month per iteration
 * (not all at once, which causes cascading collapse to 1 month).
 */
function distributeProduct(
  targetQty: number,
  allMonths: string[],
  weights: number[],
  minBatch: number,
): { month: string; qty: number }[] {
  if (allMonths.length === 0 || targetQty <= 0) return [];

  // Total below min → all in best month, no rounding up
  if (targetQty < minBatch) {
    const bestIdx = weights.indexOf(Math.max(...weights));
    return [{ month: allMonths[bestIdx]!, qty: targetQty }];
  }

  let activeIndices = allMonths.map((_, i) => i);

  for (let iteration = 0; iteration < allMonths.length; iteration++) {
    // Calculate weights for active months only
    const activeWeights = activeIndices.map(i => weights[i]!);
    const totalWeight = activeWeights.reduce((s, w) => s + w, 0);
    if (totalWeight === 0 || activeIndices.length === 0) break;

    // Proportional allocation with largest remainder
    const allocations = activeIndices.map((monthIdx, j) => ({
      monthIdx,
      month: allMonths[monthIdx]!,
      raw: targetQty * (activeWeights[j]! / totalWeight),
      qty: 0,
      remainder: 0,
    }));

    for (const a of allocations) {
      a.qty = Math.floor(a.raw);
      a.remainder = a.raw - a.qty;
    }

    // Distribute remaining units by largest remainder
    const distributed = allocations.reduce((s, a) => s + a.qty, 0);
    let remaining = targetQty - distributed;
    const byRemainder = [...allocations].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < remaining && i < byRemainder.length; i++) {
      byRemainder[i]!.qty += 1;
    }

    // Find months below min batch
    const belowMin = allocations.filter(a => a.qty > 0 && a.qty < minBatch);

    if (belowMin.length === 0) {
      // All meet minimum → done
      return allocations.filter(a => a.qty > 0).map(a => ({ month: a.month, qty: a.qty }));
    }

    // Remove only the SMALLEST below-min month (one at a time)
    const smallest = belowMin.reduce((min, a) => a.qty < min.qty ? a : min, belowMin[0]!);
    activeIndices = activeIndices.filter(i => i !== smallest.monthIdx);

    if (activeIndices.length === 0) {
      // No months left — put all in best month
      const bestIdx = weights.indexOf(Math.max(...weights));
      return [{ month: allMonths[bestIdx]!, qty: targetQty }];
    }
  }

  // Fallback
  const bestIdx = weights.indexOf(Math.max(...weights));
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
  const allMonthCodes = weightedMonths.map(m => m.month);

  // Total demand desi across all reserves
  const totalDemandDesi = reserves.reduce(
    (s, r) => s + r.targetQuantity * r.desiPerUnit, 0
  );

  // Month shares: ay_kotası / toplam_talep → fills capacity to ~99%
  const flatWeights = calculateMonthShares(weightedMonths, totalDemandDesi);

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
    // Sort by total desi descending — large products first
    const sorted = [...categoryReserves].sort(
      (a, b) => (b.targetQuantity * b.desiPerUnit) - (a.targetQuantity * a.desiPerUnit)
    );

    for (const reserve of sorted) {
      const minBatch = getMinBatchSize(reserve.desiPerUnit);

      // Mild lead time adjustment on top of flat weights
      const leadFactor = reserve.marketplaceSplit
        ? getLeadTimeFactor(reserve.marketplaceSplit)
        : 0.3;

      const adjusted = adjustWeightsForLeadTime(
        flatWeights,
        leadFactor,
        LEAD_TIME_SHIFT_STRENGTH,
      );

      // Distribute with min 15 enforcement (one-at-a-time removal)
      const monthlyQtys = distributeProduct(
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
