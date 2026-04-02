/**
 * Seasonal demand allocation — Phase-Based Waterfall Fill
 *
 * Faz 1 (Nisan-Mayıs) — strict:
 *   share = monthQuota / catRemainingDesi
 *   idealQty = remaining × share
 *   - idealQty ≥ 15         → ata
 *   - idealQty < 15 && desi ≥ 7  → skip (büyük ürün, ileriki aya)
 *   - idealQty < 15 && desi < 7  → 15'e tamamla
 *   Ay kotasına ulaşınca DUR
 *
 * Faz 2 (Haziran-Temmuz) — relaxed:
 *   Aynı ama desi≥7 skip kuralı yok; tüm ürünler idealQty<15 → 15'e tamamlanır
 *
 * Faz 3 (Ağustos+) — remaining:
 *   Kalan talebi direkt ata, kota hesabı yok
 *
 * Sıralama: Weighted lead time DESC (AU/CA önce), sonra toplam desi DESC.
 * Kategoriler bağımsız üretim hatlarında işlenir.
 */

import { getMinBatchSize, getPhase, getWeightedLeadTime, type AllocPhase } from './config';

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
// MAIN: Phase-based Waterfall allocation
// ============================================

export function allocateReserves(
  reserves: ReserveInput[],
  months: MonthCapacity[],
): AllocationResult[] {
  if (reserves.length === 0 || months.length === 0) return [];

  const totalDemandDesi = reserves.reduce(
    (s, r) => s + r.targetQuantity * r.desiPerUnit, 0
  );
  if (totalDemandDesi <= 0) return [];

  // Group by category (independent production lines)
  const byCategory = new Map<string, ReserveInput[]>();
  for (const reserve of reserves) {
    const cat = reserve.category || '_uncategorized';
    const group = byCategory.get(cat) ?? [];
    group.push(reserve);
    byCategory.set(cat, group);
  }

  // Category desi totals for quota partitioning
  const catDesiMap = new Map<string, number>();
  for (const [cat, catReserves] of Array.from(byCategory)) {
    catDesiMap.set(cat, catReserves.reduce((s, r) => s + r.targetQuantity * r.desiPerUnit, 0));
  }

  const results: AllocationResult[] = [];

  // Last 2 months are the 'remaining' overflow buffer (dynamic, not calendar-based)
  const remainingMonthSet = new Set(
    months.length >= 2
      ? months.slice(-2).map(m => m.month)
      : months.map(m => m.month)
  );

  for (const [cat, catReserves] of Array.from(byCategory)) {
    const catTotalDesi = catDesiMap.get(cat)!;
    const catShare = catTotalDesi / totalDemandDesi;

    // Sort: weighted lead time DESC (AU/CA first), then total desi DESC
    const sorted = [...catReserves].sort((a, b) => {
      const ltA = getWeightedLeadTime(a.marketplaceSplit ?? {});
      const ltB = getWeightedLeadTime(b.marketplaceSplit ?? {});
      if (ltB !== ltA) return ltB - ltA;
      return (b.targetQuantity * b.desiPerUnit) - (a.targetQuantity * a.desiPerUnit);
    });

    // Track remaining qty per product
    const remaining = new Map<string, number>();
    for (const r of sorted) remaining.set(r.iwasku, r.targetQuantity);

    for (const month of months) {
      const catRemainingDesi = sorted.reduce(
        (s, r) => s + (remaining.get(r.iwasku) ?? 0) * r.desiPerUnit, 0
      );
      if (catRemainingDesi <= 0) break;

      // 'remaining' = son 2 ay (dinamik); diğerleri takvim bazlı strict/relaxed
      const phase: AllocPhase = remainingMonthSet.has(month.month)
        ? 'remaining'
        : getPhase(month.month);

      if (phase === 'remaining') {
        // Faz 3: dump all remaining into this month (no quota check)
        for (const reserve of sorted) {
          const remQty = remaining.get(reserve.iwasku)!;
          if (remQty <= 0) continue;
          results.push({
            iwasku: reserve.iwasku,
            month: month.month,
            plannedQty: remQty,
            plannedDesi: Math.round(remQty * reserve.desiPerUnit * 10) / 10,
          });
          remaining.set(reserve.iwasku, 0);
        }
        break; // All demand consumed
      }

      // Faz 1 & 2: quota-based fill
      const monthCatQuota = month.totalDesi * catShare;
      const share = Math.min(1, monthCatQuota / catRemainingDesi);
      const minBatch = getMinBatchSize();

      let monthAllocDesi = 0;

      for (const reserve of sorted) {
        const remQty = remaining.get(reserve.iwasku)!;
        if (remQty <= 0) continue;

        // Stop if quota exceeded
        if (monthAllocDesi >= monthCatQuota) break;

        const idealQty = Math.round(remQty * share);
        const desi = reserve.desiPerUnit;

        let allocQty: number | null = null;

        if (idealQty >= minBatch) {
          allocQty = idealQty;
        } else if (phase === 'strict' && desi >= 7) {
          // Faz 1: büyük ürün, idealQty küçük → skip (ileriki aya)
          allocQty = null;
        } else {
          // Faz 1 küçük ürün veya Faz 2: 15'e tamamla (eğer remaining ≥ 15 ise)
          if (remQty >= minBatch) {
            allocQty = minBatch;
          } else {
            // Remaining itself is below 15 → dump all (will finish this product)
            allocQty = remQty;
          }
        }

        if (allocQty === null || allocQty <= 0) continue;

        // Cap at remaining
        allocQty = Math.min(allocQty, remQty);

        // Cap at remaining quota headroom
        const quotaHeadroom = monthCatQuota - monthAllocDesi;
        const maxByQuota = Math.floor(quotaHeadroom / desi);
        if (maxByQuota < minBatch && remQty > minBatch) {
          // Not enough quota left for even a min batch of this product — skip
          continue;
        }
        allocQty = Math.min(allocQty, Math.max(maxByQuota, allocQty <= minBatch ? allocQty : 0));
        if (allocQty <= 0) continue;

        results.push({
          iwasku: reserve.iwasku,
          month: month.month,
          plannedQty: allocQty,
          plannedDesi: Math.round(allocQty * desi * 10) / 10,
        });
        remaining.set(reserve.iwasku, remQty - allocQty);
        monthAllocDesi += allocQty * desi;
      }
    }

    // Safety: any unallocated demand goes to last month
    const lastMonth = months[months.length - 1]!;
    for (const reserve of sorted) {
      const remQty = remaining.get(reserve.iwasku)!;
      if (remQty > 0) {
        // Merge with existing entry for this product+month if present
        const existing = results.find(
          r => r.iwasku === reserve.iwasku && r.month === lastMonth.month
        );
        if (existing) {
          existing.plannedQty += remQty;
          existing.plannedDesi = Math.round(existing.plannedQty * reserve.desiPerUnit * 10) / 10;
        } else {
          results.push({
            iwasku: reserve.iwasku,
            month: lastMonth.month,
            plannedQty: remQty,
            plannedDesi: Math.round(remQty * reserve.desiPerUnit * 10) / 10,
          });
        }
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
