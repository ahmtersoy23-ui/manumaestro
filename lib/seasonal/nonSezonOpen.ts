/**
 * Non-Sezon "açık talep" hesaplayıcı.
 *
 * Kural: Her (iwasku, marketplaceId) çifti için en güncel ay'daki PR'a bakılır.
 * Eğer status COMPLETED/CANCELLED ise → kapanmış sayılır, rezerv etmez.
 * Aksi halde (REQUESTED, IN_PRODUCTION, PARTIALLY_PRODUCED):
 *   kalan = quantity − waterfallFilled
 * waterfallFilled, o (iwasku, ay) için Sezon waterfall'ına paralel önceliklendirme
 * ile hesaplanır (bkz. lib/seasonal/sezonProduced.ts). Sezon en düşük öncelik.
 *
 * Sonuç: iwasku başına toplam "canlı non-Sezon talep" miktarı.
 * ATP/Sezon Rez. hesabında bu miktar mevcut'tan düşülür ki yola çıkmamış
 * non-Sezon talepler Sezon rezervini yemesin.
 */

import { prisma } from '@/lib/db/prisma';

const OPEN_STATUSES = ['REQUESTED', 'IN_PRODUCTION', 'PARTIALLY_PRODUCED'] as const;

export async function getNonSezonOpenByIwasku(
  iwaskus: string[],
): Promise<Map<string, number>> {
  if (iwaskus.length === 0) return new Map();

  const sezonMp = await prisma.marketplace.findUnique({ where: { code: 'SEZON' } });

  // Bu iwasku'lar için tüm non-Sezon PR'ları al
  const allNonSezonPRs = await prisma.productionRequest.findMany({
    where: {
      iwasku: { in: iwaskus },
      ...(sezonMp ? { marketplaceId: { not: sezonMp.id } } : {}),
    },
    select: {
      id: true,
      iwasku: true,
      marketplaceId: true,
      productionMonth: true,
      quantity: true,
      status: true,
    },
  });
  if (allNonSezonPRs.length === 0) return new Map();

  // Her (iwasku, marketplaceId) için en güncel ay'ı seç
  type PR = (typeof allNonSezonPRs)[number];
  const latestByPair = new Map<string, PR>();
  for (const pr of allNonSezonPRs) {
    const key = `${pr.iwasku}|${pr.marketplaceId}`;
    const existing = latestByPair.get(key);
    if (!existing || pr.productionMonth > existing.productionMonth) {
      latestByPair.set(key, pr);
    }
  }

  // Sadece açık (REQUESTED/IN_PRODUCTION/PARTIALLY_PRODUCED) olanları tut
  const openPRs = [...latestByPair.values()].filter(pr =>
    (OPEN_STATUSES as readonly string[]).includes(pr.status),
  );
  if (openPRs.length === 0) return new Map();

  // Waterfall için: ilgili (iwasku, ay) çiftlerindeki TÜM talepler + snapshot + öncelik
  const months = [...new Set(openPRs.map(p => p.productionMonth))];
  const openIwaskus = [...new Set(openPRs.map(p => p.iwasku))];

  const [snapshots, allMonthRequests, priorities] = await Promise.all([
    prisma.monthSnapshot.findMany({
      where: { iwasku: { in: openIwaskus }, month: { in: months } },
      select: { iwasku: true, month: true, warehouseStock: true, produced: true },
    }),
    prisma.productionRequest.findMany({
      where: { iwasku: { in: openIwaskus }, productionMonth: { in: months } },
      select: {
        id: true,
        iwasku: true,
        productionMonth: true,
        marketplaceId: true,
        quantity: true,
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

  type Req = (typeof allMonthRequests)[number];
  const requestsByPair = new Map<string, Req[]>();
  for (const r of allMonthRequests) {
    const key = `${r.iwasku}|${r.productionMonth}`;
    let arr = requestsByPair.get(key);
    if (!arr) {
      arr = [];
      requestsByPair.set(key, arr);
    }
    arr.push(r);
  }

  const result = new Map<string, number>();

  // Her açık PR için waterfall simülasyonu yap, doldurulan miktarı bul
  for (const pr of openPRs) {
    const pairKey = `${pr.iwasku}|${pr.productionMonth}`;
    const snap = snapByPair.get(pairKey);
    const reqs = requestsByPair.get(pairKey) ?? [];
    const priMap = priorityByMonth.get(pr.productionMonth) ?? new Map<string, number>();

    const sorted = [...reqs].sort((a, b) => {
      const pa = priMap.get(a.marketplaceId) ?? 999;
      const pb = priMap.get(b.marketplaceId) ?? 999;
      return pa - pb;
    });

    let remaining = (snap?.warehouseStock ?? 0) + (snap?.produced ?? 0);
    let filled = 0;
    for (const r of sorted) {
      if (remaining <= 0) break;
      const f = Math.min(remaining, r.quantity);
      if (r.id === pr.id) filled = f;
      remaining -= f;
    }

    const kalan = Math.max(0, pr.quantity - filled);
    if (kalan > 0) {
      result.set(pr.iwasku, (result.get(pr.iwasku) ?? 0) + kalan);
    }
  }

  return result;
}
