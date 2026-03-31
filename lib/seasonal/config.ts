// Seasonal production planning configuration

// Minimum batch size per product per month
// If a product's monthly allocation falls below this, it won't be produced that month
// Desi-based tiers: smaller products need higher minimums (changeover cost is proportionally higher)
export const MIN_BATCH_RULES = [
  { maxDesi: 1.0, minBatch: 15 },  // Tabletop (0.33-0.6 desi)
  { maxDesi: 2.0, minBatch: 10 },  // Small metal/wood
  { maxDesi: 4.0, minBatch: 7 },   // Medium products
  { maxDesi: Infinity, minBatch: 5 }, // Large maps, furniture
] as const;

export function getMinBatchSize(desiPerUnit: number): number {
  const rule = MIN_BATCH_RULES.find(r => desiPerUnit < r.maxDesi);
  return rule?.minBatch ?? 5;
}

// ABC classification thresholds (by revenue share)
export const ABC_THRESHOLDS = {
  A: 0.80, // Top products making up 80% of revenue
  B: 0.95, // Next tier up to 95%
  // C = remaining 5%
} as const;

// ABC production frequency (how often each class is produced)
export const ABC_FREQUENCY = {
  A: 1,  // Every month
  B: 2,  // Every 2 months
  C: 3,  // Every 3 months
} as const;

export type ABCClass = 'A' | 'B' | 'C';

export function getABCClass(cumulativeRevenueShare: number): ABCClass {
  if (cumulativeRevenueShare <= ABC_THRESHOLDS.A) return 'A';
  if (cumulativeRevenueShare <= ABC_THRESHOLDS.B) return 'B';
  return 'C';
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

// Lead time priority weight (higher = produce earlier)
export function getLeadTimePriority(destination: string): number {
  const lt = DESTINATION_LEAD_TIMES[destination];
  if (!lt) return 0;
  return lt.days / 105; // Normalized: AU=1.0, US=0.57, EU=0.14
}
