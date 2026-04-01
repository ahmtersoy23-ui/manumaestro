// Seasonal production planning configuration

// Minimum batch size per product per month
// If a product's monthly allocation falls below this, it won't be produced that month
// Prevents micro-batches that are inefficient for production lines
export const MIN_BATCH = 15;

export function getMinBatchSize(_desiPerUnit?: number): number {
  return MIN_BATCH;
}

// Monthly capacity configuration (desi per working day)
export const CAPACITY_CONFIG = {
  normalDesiPerDay: 500,
  holidayDesiPerDay: 400,
} as const;

// Production period definitions
export const PRODUCTION_PERIODS = {
  normal1: { start: '2026-03-30', end: '2026-06-26', type: 'normal' as const },
  holiday: { start: '2026-06-29', end: '2026-09-18', type: 'holiday' as const },
  normal2: { start: '2026-09-21', end: '2026-11-27', type: 'normal' as const },
};

// Shipping destinations and lead times
export const DESTINATION_LEAD_TIMES: Record<string, { days: number; method: string }> = {
  AU: { days: 105, method: 'sea' },
  US: { days: 60, method: 'sea' },
  CA: { days: 60, method: 'sea' },
  SHOPIFY_US: { days: 30, method: 'sea' },
  UK: { days: 15, method: 'road' },
  EU: { days: 15, method: 'road' },
  NL: { days: 15, method: 'road' },
  AE: { days: 7, method: 'air' },
  ZA: { days: 30, method: 'sea' },
};

// Max lead time (AU=105 days) — used for normalization
const MAX_LEAD_TIME = 105;

// Lead time priority weight (higher = produce earlier)
export function getLeadTimePriority(destination: string): number {
  const lt = DESTINATION_LEAD_TIMES[destination];
  if (!lt) return 0;
  return lt.days / MAX_LEAD_TIME; // Normalized: AU=1.0, US=0.57, EU=0.14
}

// Lead time weight shift strength (0.0 = no shift, 1.0 = max shift)
// 0.4 means AU-heavy products get ~20% more in early months, ~20% less in late months
export const LEAD_TIME_SHIFT_STRENGTH = 0.4;

// Calculate weighted lead time from marketplace split
export function getWeightedLeadTime(marketplaceSplit: Record<string, number>): number {
  let totalQty = 0;
  let weightedSum = 0;

  for (const [market, qty] of Object.entries(marketplaceSplit)) {
    if (qty <= 0) continue;
    const lt = DESTINATION_LEAD_TIMES[market];
    const days = lt?.days ?? 30; // default 30 days for unknown markets
    weightedSum += qty * days;
    totalQty += qty;
  }

  if (totalQty === 0) return 30; // default
  return weightedSum / totalQty;
}

// Normalize lead time to 0-1 factor
export function getLeadTimeFactor(marketplaceSplit: Record<string, number>): number {
  const wlt = getWeightedLeadTime(marketplaceSplit);
  return Math.min(1, Math.max(0, wlt / MAX_LEAD_TIME));
}
