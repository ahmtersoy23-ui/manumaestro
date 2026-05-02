/**
 * ABC sınıflandırması — son N gün hareket frekansına göre.
 *
 * A items: Top %20 (en sık hareket — günlük sayım nadir, ayda 1)
 * B items: Sonraki %30
 * C items: Alt %50
 *
 * Frekans = ShelfMovement count (OUTBOUND + TRANSFER + BOX_BREAK).
 * Tek SKU bazlı; depo bazlı sınırlama opsiyonel.
 */

import { prisma } from '@/lib/db/prisma';

export type AbcClass = 'A' | 'B' | 'C';

export interface AbcResult {
  iwasku: string;
  movementCount: number;
  cumulativePct: number;
  class: AbcClass;
}

const FREQUENCY_DAYS_DEFAULT = 90;
const A_PCT = 0.2;
const B_PCT = 0.5; // A + B = %50

export async function classifyAbc(
  warehouseCode: string,
  windowDays: number = FREQUENCY_DAYS_DEFAULT
): Promise<Map<string, AbcClass>> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const grouped = await prisma.shelfMovement.groupBy({
    by: ['iwasku'],
    where: {
      warehouseCode,
      createdAt: { gte: since },
      type: { in: ['OUTBOUND', 'TRANSFER', 'BOX_BREAK'] },
      iwasku: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { iwasku: 'desc' } },
  });

  const sorted = grouped
    .filter((g) => g.iwasku !== null)
    .map((g) => ({ iwasku: g.iwasku as string, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  const totalEvents = sorted.reduce((sum, x) => sum + x.count, 0);
  const result = new Map<string, AbcClass>();

  if (totalEvents === 0) return result;

  // A/B sınırı SKU sayısı bazlı (Pareto pratiği)
  const skuCount = sorted.length;
  const aLimit = Math.max(1, Math.ceil(skuCount * A_PCT));
  const bLimit = Math.max(aLimit + 1, Math.ceil(skuCount * B_PCT));

  sorted.forEach((item, idx) => {
    let cls: AbcClass;
    if (idx < aLimit) cls = 'A';
    else if (idx < bLimit) cls = 'B';
    else cls = 'C';
    result.set(item.iwasku, cls);
  });

  return result;
}

/**
 * Tolerance kuralı: A=0 (sıfır tolerans), B=1, C=2.
 * Bilinmeyen SKU (hareket yok) → C (en gevşek).
 */
export function toleranceForClass(cls: AbcClass | null): number {
  switch (cls) {
    case 'A':
      return 0;
    case 'B':
      return 1;
    default:
      return 2;
  }
}

/**
 * Sayım frekansı (gün): A=30, B=90, C=180.
 */
export function frequencyDaysForClass(cls: AbcClass | null): number {
  switch (cls) {
    case 'A':
      return 30;
    case 'B':
      return 90;
    default:
      return 180;
  }
}
