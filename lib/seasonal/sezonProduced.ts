/**
 * Sezon havuzuna fiilen giden üretimi hesaplar.
 *
 * MonthSnapshot.produced tek doğruluk kaynağı; ama ProductionRequest.producedQuantity
 * alanı deprecated ve güncellenmiyor. Sezon marketplace'i release sırasında en düşük
 * önceliğe atandığından, o ay/ürün için gerçekleşen üretim önce diğer marketplace'lere
 * dağıtılır, kalanı Sezon'a düşer.
 *
 * Bu helper her (iwasku, month) çifti için waterfallComplete ile aynı algoritmayı
 * simüle edip Sezon'a düşen adet/desi payını döndürür. PARTIALLY_PRODUCED durumları
 * da dahil olur — status yerine "remaining available" akışı üzerinden hesaplanır.
 */

import { prisma } from '@/lib/db/prisma';

export type SezonProducedResult = {
  byIwaskuQty: Map<string, number>;
  byIwaskuDesi: Map<string, number>;
  byMonthQty: Map<string, number>;
  byMonthDesi: Map<string, number>;
  byIwaskuMonth: Map<string, { qty: number; desi: number }>;
};

const EMPTY: SezonProducedResult = {
  byIwaskuQty: new Map(),
  byIwaskuDesi: new Map(),
  byMonthQty: new Map(),
  byMonthDesi: new Map(),
  byIwaskuMonth: new Map(),
};

export async function computeSezonProduced(poolId: string): Promise<SezonProducedResult> {
  const sezonMp = await prisma.marketplace.findUnique({ where: { code: 'SEZON' } });
  if (!sezonMp) return EMPTY;

  const sezonRequests = await prisma.productionRequest.findMany({
    where: {
      marketplaceId: sezonMp.id,
      notes: { contains: `[pool:${poolId}]` },
    },
    select: { iwasku: true, productionMonth: true, quantity: true, productSize: true },
  });
  if (sezonRequests.length === 0) return EMPTY;

  const pairs = new Set(sezonRequests.map(r => `${r.iwasku}|${r.productionMonth}`));
  const iwaskus = [...new Set(sezonRequests.map(r => r.iwasku))];
  const months = [...new Set(sezonRequests.map(r => r.productionMonth))];

  const [snapshots, allRequests, priorities] = await Promise.all([
    prisma.monthSnapshot.findMany({
      where: { iwasku: { in: iwaskus }, month: { in: months } },
      select: { iwasku: true, month: true, warehouseStock: true, produced: true },
    }),
    prisma.productionRequest.findMany({
      where: { iwasku: { in: iwaskus }, productionMonth: { in: months } },
      select: {
        iwasku: true,
        productionMonth: true,
        marketplaceId: true,
        quantity: true,
        productSize: true,
      },
    }),
    prisma.marketplacePriority.findMany({
      where: { month: { in: months } },
      select: { month: true, marketplaceId: true, priority: true },
    }),
  ]);

  const snapByPair = new Map<string, { warehouseStock: number; produced: number }>();
  for (const s of snapshots) snapByPair.set(`${s.iwasku}|${s.month}`, s);

  const priorityByMonth = new Map<string, Map<string, number>>();
  for (const p of priorities) {
    let m = priorityByMonth.get(p.month);
    if (!m) {
      m = new Map();
      priorityByMonth.set(p.month, m);
    }
    m.set(p.marketplaceId, p.priority);
  }

  type Req = (typeof allRequests)[number];
  const requestsByPair = new Map<string, Req[]>();
  for (const r of allRequests) {
    const key = `${r.iwasku}|${r.productionMonth}`;
    let arr = requestsByPair.get(key);
    if (!arr) {
      arr = [];
      requestsByPair.set(key, arr);
    }
    arr.push(r);
  }

  const byIwaskuMonth = new Map<string, { qty: number; desi: number }>();
  const byIwaskuQty = new Map<string, number>();
  const byIwaskuDesi = new Map<string, number>();
  const byMonthQty = new Map<string, number>();
  const byMonthDesi = new Map<string, number>();

  for (const pair of pairs) {
    const [iwasku, month] = pair.split('|');
    const snap = snapByPair.get(pair);
    const reqs = requestsByPair.get(pair) ?? [];
    const priMap = priorityByMonth.get(month) ?? new Map<string, number>();
    const sorted = [...reqs].sort((a, b) => {
      const pa = priMap.get(a.marketplaceId) ?? 999;
      const pb = priMap.get(b.marketplaceId) ?? 999;
      return pa - pb;
    });
    let remaining = (snap?.warehouseStock ?? 0) + (snap?.produced ?? 0);
    let sezonQty = 0;
    let sezonDesi = 0;
    for (const r of sorted) {
      if (remaining <= 0) break;
      const filled = Math.min(remaining, r.quantity);
      if (r.marketplaceId === sezonMp.id) {
        sezonQty += filled;
        sezonDesi += filled * (r.productSize ?? 0);
      }
      remaining -= filled;
    }
    if (sezonQty > 0 || sezonDesi > 0) {
      byIwaskuMonth.set(pair, { qty: sezonQty, desi: sezonDesi });
      byIwaskuQty.set(iwasku, (byIwaskuQty.get(iwasku) ?? 0) + sezonQty);
      byIwaskuDesi.set(iwasku, (byIwaskuDesi.get(iwasku) ?? 0) + sezonDesi);
      byMonthQty.set(month, (byMonthQty.get(month) ?? 0) + sezonQty);
      byMonthDesi.set(month, (byMonthDesi.get(month) ?? 0) + sezonDesi);
    }
  }

  return { byIwaskuQty, byIwaskuDesi, byMonthQty, byMonthDesi, byIwaskuMonth };
}

/**
 * Belirli IWASKU'lar için aktif tüm SEASONAL havuzlardaki sezon üretimini hesaplar.
 * ATP ve snapshot için kullanılır — `StockReserve.producedQuantity` DB'de yazılmıyor,
 * dinamik hesap tek doğru kaynak.
 *
 * Dönen değer: Map<iwasku, sezonProduced (qty)> — sıfır olanlar dahil edilmez.
 */
export async function getSezonProducedByIwasku(
  iwaskus: string[],
): Promise<Map<string, number>> {
  if (iwaskus.length === 0) return new Map();

  // Bu IWASKU'ları içeren aktif SEASONAL havuzları bul
  const reserves = await prisma.stockReserve.findMany({
    where: {
      iwasku: { in: iwaskus },
      pool: { poolType: 'SEASONAL', status: 'ACTIVE' },
      status: { not: 'CANCELLED' },
    },
    select: { poolId: true },
  });
  const poolIds = [...new Set(reserves.map(r => r.poolId))];
  if (poolIds.length === 0) return new Map();

  // Her havuz için sezon üretimini hesapla, iwasku başına birleştir
  const merged = new Map<string, number>();
  const results = await Promise.all(poolIds.map(id => computeSezonProduced(id)));
  for (const result of results) {
    for (const [iwasku, qty] of result.byIwaskuQty) {
      if (qty <= 0) continue;
      merged.set(iwasku, (merged.get(iwasku) ?? 0) + qty);
    }
  }
  return merged;
}
