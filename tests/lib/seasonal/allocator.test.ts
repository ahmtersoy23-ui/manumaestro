/**
 * Seasonal Allocator Tests — Phase-Based Waterfall Fill
 *
 * Tests the core allocation logic:
 *   Phase 1 (strict, Apr-May): big-product skip, min batch rounding
 *   Phase 2 (relaxed, Jun-Jul): no desi skip, min batch still applies
 *   Phase 3 (remaining, last 2 months): dump all, no quota
 *   Safety net: unallocated demand always lands in the last month
 */

import { describe, it, expect } from 'vitest';
import {
  allocateReserves,
  calculateMonthWeights,
  summarizeByMonth,
  type ReserveInput,
  type MonthCapacity,
  type AllocationResult,
} from '@/lib/seasonal/allocator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a month with explicit totalDesi (weight is recalculated by the allocator) */
function month(m: string, totalDesi: number): MonthCapacity {
  return { month: m, workingDays: 20, desiPerDay: totalDesi / 20, totalDesi, weight: 0 };
}

/** Shorthand reserve input */
function reserve(
  iwasku: string,
  targetQuantity: number,
  desiPerUnit: number,
  opts?: { category?: string; marketplaceSplit?: Record<string, number> },
): ReserveInput {
  return {
    iwasku,
    targetQuantity,
    desiPerUnit,
    category: opts?.category ?? 'home',
    marketplaceSplit: opts?.marketplaceSplit,
  };
}

/** Find all allocations for a given iwasku */
function forSku(results: AllocationResult[], iwasku: string) {
  return results.filter(r => r.iwasku === iwasku);
}

/** Total planned qty across all months for a given iwasku */
function totalQty(results: AllocationResult[], iwasku: string) {
  return forSku(results, iwasku).reduce((s, r) => s + r.plannedQty, 0);
}

/** Total planned desi for a given month */
function monthDesi(results: AllocationResult[], m: string) {
  return results.filter(r => r.month === m).reduce((s, r) => s + r.plannedDesi, 0);
}

// ===========================================================================
// 1. Empty input
// ===========================================================================

describe('allocateReserves', () => {
  describe('empty input', () => {
    it('returns [] when reserves is empty', () => {
      const months = [month('2026-04', 1000)];
      expect(allocateReserves([], months)).toEqual([]);
    });

    it('returns [] when months is empty', () => {
      const reserves = [reserve('SKU-A', 100, 2)];
      expect(allocateReserves(reserves, [])).toEqual([]);
    });

    it('returns [] when both are empty', () => {
      expect(allocateReserves([], [])).toEqual([]);
    });

    it('returns [] when all targetQuantity is 0', () => {
      const reserves = [reserve('SKU-A', 0, 2)];
      const months = [month('2026-04', 1000)];
      expect(allocateReserves(reserves, months)).toEqual([]);
    });
  });

  // =========================================================================
  // 2. Strict phase (Apr-May)
  // =========================================================================

  describe('strict phase (Apr-May)', () => {
    // 4 months: Apr (strict), May (strict), Jun (remaining), Jul (remaining)
    // Last 2 months = Jun+Jul are 'remaining'
    const fourMonths = [
      month('2026-04', 5000),
      month('2026-05', 5000),
      month('2026-06', 5000),
      month('2026-07', 5000),
    ];

    it('allocates when idealQty >= 15', () => {
      // Single small-desi product with 100 qty, desi=2 → totalDesi=200
      // Apr quota=5000 easily fits 200 desi. share = 5000/200 = capped at 1 → idealQty=100 ≥ 15 → allocate
      const reserves = [reserve('SKU-SMALL', 100, 2)];
      const results = allocateReserves(reserves, fourMonths);

      // Product should be allocated (not skipped)
      expect(results.length).toBeGreaterThan(0);
      expect(totalQty(results, 'SKU-SMALL')).toBe(100);
    });

    it('skips big product (desi >= 7) when idealQty < 15 in strict phase', () => {
      // Big product: desi=8, qty=10. totalDesi = 80.
      // Small product: desi=1, qty=5000. totalDesi = 5000.
      // Combined totalDesi = 5080. Apr share = 5000/5080 ≈ 0.984
      // Big product idealQty = round(10 * 0.984) = 10 < 15, desi=8 ≥ 7 → SKIP in strict
      // The big product should be deferred to a later month (remaining phase).
      const reserves = [
        reserve('SKU-BIG', 10, 8),
        reserve('SKU-FILL', 5000, 1),
      ];
      const results = allocateReserves(reserves, fourMonths);

      // SKU-BIG should NOT appear in April
      const bigInApr = results.find(r => r.iwasku === 'SKU-BIG' && r.month === '2026-04');
      expect(bigInApr).toBeUndefined();

      // But it must be allocated somewhere (safety net guarantees this)
      expect(totalQty(results, 'SKU-BIG')).toBe(10);
    });

    it('rounds up small product (desi < 7) to min 15 when idealQty < 15', () => {
      // Give SKU-SM an AU split so it sorts first (higher lead time = processed first)
      // and thus has full quota headroom.
      // SKU-SM: desi=3, qty=20. SKU-FILLER: desi=1, qty=8000.
      // Combined totalDesi = 60 + 8000 = 8060. Apr share = 5000/8060 ≈ 0.620
      // SKU-SM first (AU lead time 105 > default 30):
      //   idealQty = round(20 * 0.620) = 12 < 15, desi=3 < 7 → round up to 15
      //   headroom = 5000, maxByQuota = 1666 → no skip
      const reserves = [
        reserve('SKU-SM', 20, 3, { marketplaceSplit: { AU: 20 } }),
        reserve('SKU-FILLER', 8000, 1),
      ];
      const results = allocateReserves(reserves, fourMonths);

      const smInApr = results.find(r => r.iwasku === 'SKU-SM' && r.month === '2026-04');
      expect(smInApr).toBeDefined();
      expect(smInApr!.plannedQty).toBe(15);
    });

    it('dumps remaining qty when remaining < minBatch for a small product', () => {
      // Product with only 8 qty remaining (< 15), desi=2 → will dump all 8
      // In strict: idealQty < 15, desi < 7, but remaining (8) < 15 → dump all
      const reserves = [reserve('SKU-TINY', 8, 2)];
      const results = allocateReserves(reserves, fourMonths);

      expect(totalQty(results, 'SKU-TINY')).toBe(8);
    });
  });

  // =========================================================================
  // 3. Relaxed phase (Jun-Jul)
  // =========================================================================

  describe('relaxed phase (Jun-Jul)', () => {
    // 4 months: Jun (relaxed), Jul (relaxed), Aug (remaining), Sep (remaining)
    const fourMonths = [
      month('2026-06', 5000),
      month('2026-07', 5000),
      month('2026-08', 5000),
      month('2026-09', 5000),
    ];

    it('does NOT skip big product (desi >= 7) in relaxed phase — rounds up to 15', () => {
      // Big product: desi=8, qty=10, totalDesi=80
      // Filler: desi=1, qty=5000, totalDesi=5000
      // Combined = 5080. Jun share ≈ 0.984
      // Big product idealQty = round(10*0.984) = 10 < 15
      // In relaxed phase: no desi≥7 skip → round up. But remaining=10 < 15 → dump all 10
      const reserves = [
        reserve('SKU-BIG-R', 10, 8),
        reserve('SKU-FILL-R', 5000, 1),
      ];
      const results = allocateReserves(reserves, fourMonths);

      // SKU-BIG-R should appear in June (not skipped)
      const bigInJun = results.find(r => r.iwasku === 'SKU-BIG-R' && r.month === '2026-06');
      expect(bigInJun).toBeDefined();
      expect(bigInJun!.plannedQty).toBe(10);
    });

    it('allocates min 15 for big product when remaining >= 15', () => {
      // Give SKU-BIG-15 an AU marketplace split so it sorts first (lead time 105 > 30)
      // and processes with full quota headroom.
      // Big product: desi=8, qty=20, totalDesi=160.
      // Filler: desi=1, qty=10000, totalDesi=10000.
      // Combined = 10160. Jun share = 5000/10160 ≈ 0.492
      // SKU-BIG-15 processed first:
      //   idealQty = round(20*0.492) = 10 < 15
      //   Relaxed: no desi skip, remQty(20) >= 15 → allocQty = 15
      //   headroom = 5000, maxByQuota = 625 → no skip
      const reserves = [
        reserve('SKU-BIG-15', 20, 8, { marketplaceSplit: { AU: 20 } }),
        reserve('SKU-FILL-15', 10000, 1),
      ];
      const results = allocateReserves(reserves, fourMonths);

      const bigInJun = results.find(r => r.iwasku === 'SKU-BIG-15' && r.month === '2026-06');
      expect(bigInJun).toBeDefined();
      expect(bigInJun!.plannedQty).toBe(15);
      expect(totalQty(results, 'SKU-BIG-15')).toBe(20);
    });
  });

  // =========================================================================
  // 4. Remaining phase (last 2 months)
  // =========================================================================

  describe('remaining phase (last 2 months)', () => {
    it('dumps all remaining demand into the first remaining-phase month', () => {
      // 3 months: Apr (strict), May (remaining), Jun (remaining)
      // Give Apr very low quota so most demand spills to remaining phase
      const months = [
        month('2026-04', 100),   // tight
        month('2026-05', 5000),  // remaining
        month('2026-06', 5000),  // remaining
      ];
      const reserves = [reserve('SKU-DUMP', 200, 2)];  // totalDesi=400 >> Apr quota=100

      const results = allocateReserves(reserves, months);

      // Everything should be allocated
      expect(totalQty(results, 'SKU-DUMP')).toBe(200);

      // Remaining phase dumps everything in the first remaining month (break after loop)
      const inMay = results.find(r => r.iwasku === 'SKU-DUMP' && r.month === '2026-05');
      expect(inMay).toBeDefined();
      expect(inMay!.plannedQty).toBeGreaterThan(0);
    });

    it('has no quota limit in remaining phase', () => {
      // 2 months: both are remaining (since there are only 2)
      const months = [
        month('2026-08', 100),  // remaining — tiny capacity but no quota enforcement
        month('2026-09', 100),  // remaining
      ];
      const reserves = [reserve('SKU-OVER', 500, 3)]; // 1500 desi, way over capacity

      const results = allocateReserves(reserves, months);

      // All demand allocated despite desi >> capacity
      expect(totalQty(results, 'SKU-OVER')).toBe(500);
    });
  });

  // =========================================================================
  // 5. Quota fill — month fills to capacity, then spills
  // =========================================================================

  describe('quota fill', () => {
    it('spills to next month when quota is exhausted', () => {
      // 4 months: Apr tight, May tight, Jun remaining, Jul remaining
      const months = [
        month('2026-04', 300),  // strict, fits ~150 units at desi=2
        month('2026-05', 300),  // strict
        month('2026-06', 5000), // remaining
        month('2026-07', 5000), // remaining
      ];
      // 500 units * 2 desi = 1000 desi total. Apr+May=600 desi combined.
      const reserves = [reserve('SKU-SPILL', 500, 2)];
      const results = allocateReserves(reserves, months);

      // Apr should not exceed its 300 desi quota
      const aprDesi = monthDesi(results, '2026-04');
      expect(aprDesi).toBeLessThanOrEqual(300);

      // Total must equal full demand
      expect(totalQty(results, 'SKU-SPILL')).toBe(500);
    });

    it('allocates across multiple months for multiple products', () => {
      const months = [
        month('2026-04', 500),
        month('2026-05', 500),
        month('2026-06', 5000),
        month('2026-07', 5000),
      ];
      const reserves = [
        reserve('A', 100, 3), // 300 desi
        reserve('B', 200, 2), // 400 desi
        reserve('C', 150, 4), // 600 desi
      ];
      const results = allocateReserves(reserves, months);

      // All demand fulfilled
      expect(totalQty(results, 'A')).toBe(100);
      expect(totalQty(results, 'B')).toBe(200);
      expect(totalQty(results, 'C')).toBe(150);
    });
  });

  // =========================================================================
  // 6. Lead time sorting — AU/CA products come first
  // =========================================================================

  describe('lead time sorting', () => {
    it('prioritizes AU-heavy products (longer lead time) earlier', () => {
      // Two products with identical demand/desi, but different marketplace splits
      // AU product: AU lead time = 105 days (highest priority)
      // EU product: UK lead time = 15 days (lower priority)
      const months = [
        month('2026-04', 400), // Only 400 desi — not enough for both (200 desi each)
        month('2026-05', 400),
        month('2026-06', 5000),
        month('2026-07', 5000),
      ];
      const reserves = [
        reserve('SKU-EU', 100, 2, { marketplaceSplit: { UK: 100 } }),
        reserve('SKU-AU', 100, 2, { marketplaceSplit: { AU: 100 } }),
      ];
      const results = allocateReserves(reserves, months);

      // AU product should have allocation in April (processed first due to higher lead time)
      const auInApr = results.find(r => r.iwasku === 'SKU-AU' && r.month === '2026-04');
      expect(auInApr).toBeDefined();
      expect(auInApr!.plannedQty).toBeGreaterThan(0);
    });

    it('sorts by total desi DESC when lead times are equal', () => {
      // Two products with same marketplace split but different demand
      const months = [
        month('2026-06', 10000),
        month('2026-07', 10000),
        month('2026-08', 10000),
        month('2026-09', 10000),
      ];
      const reserves = [
        reserve('SKU-SMALL-D', 50, 2, { marketplaceSplit: { US: 50 } }),  // 100 desi
        reserve('SKU-LARGE-D', 200, 2, { marketplaceSplit: { US: 200 } }), // 400 desi
      ];
      const results = allocateReserves(reserves, months);

      // Both should be allocated (enough capacity)
      expect(totalQty(results, 'SKU-SMALL-D')).toBe(50);
      expect(totalQty(results, 'SKU-LARGE-D')).toBe(200);
    });
  });

  // =========================================================================
  // 7. Safety net — unallocated demand goes to last month
  // =========================================================================

  describe('safety net', () => {
    it('guarantees no demand is lost even when skipped in strict phase', () => {
      // Big product (desi >= 7) gets skipped in both strict months
      // but is caught by the remaining phase, ensuring full allocation.
      const months = [
        month('2026-04', 200),
        month('2026-05', 200),
        month('2026-06', 5000),
        month('2026-07', 5000),
      ];
      const reserves = [
        reserve('SKU-BIG-SAFE', 5, 10, { marketplaceSplit: { UK: 5 } }),
        reserve('SKU-FILL-SAFE', 400, 1),
      ];
      const results = allocateReserves(reserves, months);

      // SKU-BIG-SAFE skipped in strict Apr+May (idealQty=5 < 15, desi=10 >= 7)
      // but caught in remaining phase (Jun)
      expect(totalQty(results, 'SKU-BIG-SAFE')).toBe(5);
      expect(totalQty(results, 'SKU-FILL-SAFE')).toBe(400);

      // Should NOT appear in strict months
      const bigApr = results.find(r => r.iwasku === 'SKU-BIG-SAFE' && r.month === '2026-04');
      const bigMay = results.find(r => r.iwasku === 'SKU-BIG-SAFE' && r.month === '2026-05');
      expect(bigApr).toBeUndefined();
      expect(bigMay).toBeUndefined();

      // Must appear in remaining phase
      const bigJun = results.find(r => r.iwasku === 'SKU-BIG-SAFE' && r.month === '2026-06');
      expect(bigJun).toBeDefined();
      expect(bigJun!.plannedQty).toBe(5);
    });

    it('conserves total demand across all months regardless of quota pressure', () => {
      // Heavy demand vs limited quota — demand spills to remaining phase
      const months = [
        month('2026-04', 100),
        month('2026-05', 100),
        month('2026-06', 100),
        month('2026-07', 100),
      ];
      const reserves = [
        reserve('SKU-NET', 300, 2), // 600 desi total, capacity = 400 total
      ];
      const results = allocateReserves(reserves, months);

      // Conservation: entire demand must be allocated
      expect(totalQty(results, 'SKU-NET')).toBe(300);

      // Remaining phase (Jun) absorbs overflow from strict months
      const inJun = results.find(r => r.iwasku === 'SKU-NET' && r.month === '2026-06');
      expect(inJun).toBeDefined();
      expect(inJun!.plannedQty).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 8. Single product, single month
  // =========================================================================

  describe('single product, single month', () => {
    it('allocates all demand to the only month (remaining phase)', () => {
      // 1 month = last month = remaining phase
      const months = [month('2026-06', 5000)];
      const reserves = [reserve('SKU-SOLO', 80, 3)];

      const results = allocateReserves(reserves, months);

      expect(results).toHaveLength(1);
      expect(results[0].iwasku).toBe('SKU-SOLO');
      expect(results[0].month).toBe('2026-06');
      expect(results[0].plannedQty).toBe(80);
      expect(results[0].plannedDesi).toBe(240); // 80 * 3
    });

    it('handles desi rounding correctly', () => {
      const months = [month('2026-04', 5000)];
      const reserves = [reserve('SKU-ROUND', 7, 1.3)];
      const results = allocateReserves(reserves, months);

      expect(totalQty(results, 'SKU-ROUND')).toBe(7);
      // 7 * 1.3 = 9.1 — should be rounded to 1 decimal
      const totalDesi = forSku(results, 'SKU-ROUND')
        .reduce((s, r) => s + r.plannedDesi, 0);
      expect(totalDesi).toBe(9.1);
    });
  });

  // =========================================================================
  // 9. Multi product, multi month — realistic scenario
  // =========================================================================

  describe('multi product, multi month (realistic)', () => {
    const seasonMonths: MonthCapacity[] = [
      month('2026-04', 3000),  // strict
      month('2026-05', 3500),  // strict
      month('2026-06', 4000),  // remaining (last 2)
      month('2026-07', 4000),  // remaining (last 2)
    ];

    const productMix: ReserveInput[] = [
      // AU-heavy large shipment — should be produced first
      reserve('IWA-RUG-001', 200, 4.5, {
        category: 'rugs',
        marketplaceSplit: { AU: 120, US: 80 },
      }),
      // EU small product — desi < 7, gets min batch treatment
      reserve('IWA-TOWEL-002', 50, 1.2, {
        category: 'towels',
        marketplaceSplit: { UK: 30, EU: 20 },
      }),
      // Big desi product for US — may get skipped in strict
      reserve('IWA-CARPET-003', 12, 9.5, {
        category: 'carpets',
        marketplaceSplit: { US: 12 },
      }),
      // CA product — higher lead time (60 days, same as US)
      reserve('IWA-MAT-004', 80, 2.8, {
        category: 'mats',
        marketplaceSplit: { CA: 50, US: 30 },
      }),
      // Small quantity, small desi
      reserve('IWA-CLOTH-005', 30, 0.8, {
        category: 'cloths',
        marketplaceSplit: { AE: 30 },
      }),
    ];

    it('allocates ALL demand across months (conservation)', () => {
      const results = allocateReserves(productMix, seasonMonths);

      expect(totalQty(results, 'IWA-RUG-001')).toBe(200);
      expect(totalQty(results, 'IWA-TOWEL-002')).toBe(50);
      expect(totalQty(results, 'IWA-CARPET-003')).toBe(12);
      expect(totalQty(results, 'IWA-MAT-004')).toBe(80);
      expect(totalQty(results, 'IWA-CLOTH-005')).toBe(30);
    });

    it('respects strict-phase quota in April and May', () => {
      const results = allocateReserves(productMix, seasonMonths);

      expect(monthDesi(results, '2026-04')).toBeLessThanOrEqual(3000);
      expect(monthDesi(results, '2026-05')).toBeLessThanOrEqual(3500);
    });

    it('produces AU-heavy product earlier than AE-only product', () => {
      const results = allocateReserves(productMix, seasonMonths);

      // AU-heavy (IWA-RUG-001, weighted LT ~85 days) should have April allocation
      const rugApr = results.find(r => r.iwasku === 'IWA-RUG-001' && r.month === '2026-04');
      expect(rugApr).toBeDefined();
      expect(rugApr!.plannedQty).toBeGreaterThan(0);
    });

    it('skips big-desi carpet in strict phase when idealQty < 15', () => {
      const results = allocateReserves(productMix, seasonMonths);

      // IWA-CARPET-003: qty=12, desi=9.5 → totalDesi=114
      // Total all products desi = 200*4.5 + 50*1.2 + 12*9.5 + 80*2.8 + 30*0.8
      //                         = 900 + 60 + 114 + 224 + 24 = 1322
      // Apr share = 3000/1322 ≈ 2.27, capped at 1 → idealQty = round(12*1) = 12
      // 12 < 15, desi=9.5 ≥ 7 → skip in strict phase
      // The carpet should NOT appear in April
      const carpetApr = results.find(r => r.iwasku === 'IWA-CARPET-003' && r.month === '2026-04');
      expect(carpetApr).toBeUndefined();

      // But it must be allocated somewhere
      expect(totalQty(results, 'IWA-CARPET-003')).toBe(12);
    });

    it('produces results with correct plannedDesi values', () => {
      const results = allocateReserves(productMix, seasonMonths);

      for (const r of results) {
        const input = productMix.find(p => p.iwasku === r.iwasku)!;
        const expectedDesi = Math.round(r.plannedQty * input.desiPerUnit * 10) / 10;
        expect(r.plannedDesi).toBe(expectedDesi);
      }
    });
  });

  // =========================================================================
  // calculateMonthWeights
  // =========================================================================

  describe('calculateMonthWeights', () => {
    it('calculates proportional weights', () => {
      const months = [
        month('2026-04', 3000),
        month('2026-05', 7000),
      ];
      const weighted = calculateMonthWeights(months);

      expect(weighted[0].weight).toBeCloseTo(0.3, 5);
      expect(weighted[1].weight).toBeCloseTo(0.7, 5);
    });

    it('returns equal weights when all totalDesi are zero', () => {
      const months = [
        month('2026-04', 0),
        month('2026-05', 0),
        month('2026-06', 0),
      ];
      const weighted = calculateMonthWeights(months);

      for (const m of weighted) {
        expect(m.weight).toBeCloseTo(1 / 3, 5);
      }
    });

    it('returns weight=1 for single month', () => {
      const weighted = calculateMonthWeights([month('2026-04', 500)]);
      expect(weighted[0].weight).toBe(1);
    });
  });

  // =========================================================================
  // summarizeByMonth
  // =========================================================================

  describe('summarizeByMonth', () => {
    it('aggregates allocations by month', () => {
      const allocations: AllocationResult[] = [
        { iwasku: 'A', month: '2026-04', plannedQty: 50, plannedDesi: 100 },
        { iwasku: 'B', month: '2026-04', plannedQty: 30, plannedDesi: 60 },
        { iwasku: 'A', month: '2026-05', plannedQty: 20, plannedDesi: 40 },
      ];
      const summary = summarizeByMonth(allocations);

      expect(summary).toHaveLength(2);

      const apr = summary.find(s => s.month === '2026-04')!;
      expect(apr.totalQty).toBe(80);
      expect(apr.totalDesi).toBe(160);
      expect(apr.productCount).toBe(2);

      const may = summary.find(s => s.month === '2026-05')!;
      expect(may.totalQty).toBe(20);
      expect(may.totalDesi).toBe(40);
      expect(may.productCount).toBe(1);
    });

    it('returns sorted by month ascending', () => {
      const allocations: AllocationResult[] = [
        { iwasku: 'A', month: '2026-06', plannedQty: 10, plannedDesi: 20 },
        { iwasku: 'A', month: '2026-04', plannedQty: 10, plannedDesi: 20 },
        { iwasku: 'A', month: '2026-05', plannedQty: 10, plannedDesi: 20 },
      ];
      const summary = summarizeByMonth(allocations);

      expect(summary.map(s => s.month)).toEqual(['2026-04', '2026-05', '2026-06']);
    });

    it('returns empty array for empty input', () => {
      expect(summarizeByMonth([])).toEqual([]);
    });
  });
});
