/**
 * ATP (Available to Promise) calculation
 *
 * ATP = mevcut − sezonRez − sevkRez
 *
 * Mevcut          = eskiStok + ilaveStok + weeklyProduction − cikis − weeklyShipment
 * Sezon rezervi   = (initialStock − shippedQuantity) + sezonProduced (waterfall, dinamik)
 * Sevkiyat rez.   = SUM(shipment_items.quantity) WHERE packed AND sent_at IS NULL
 *                   (kolilenmiş ama henüz sevk edilmemiş — Ankara'dan çıkacak)
 *
 * Açık non-Sezon talepler ATP'den DÜŞÜLMEZ — onlar zaten "talep" havuzunun parçası
 * ve sonraki ayda yenilenirler. Karşılanmayan istisna kalemler için (örn. AU)
 * yeni ay'da yeni PR girilir.
 */

import { prisma } from './prisma';
import { getSezonProducedByIwasku } from '@/lib/seasonal/sezonProduced';

export interface ATPResult {
  iwasku: string;
  mevcut: number;
  reserved: number;
  shipmentReserved: number;
  atp: number;
}

export async function getATP(iwasku: string): Promise<ATPResult> {
  const results = await getATPBulk([iwasku]);
  return (
    results[0] ?? {
      iwasku,
      mevcut: 0,
      reserved: 0,
      shipmentReserved: 0,
      atp: 0,
    }
  );
}

export async function getATPBulk(iwaskus: string[]): Promise<ATPResult[]> {
  if (iwaskus.length === 0) return [];

  const warehouseProducts = await prisma.warehouseProduct.findMany({
    where: { iwasku: { in: iwaskus } },
    include: {
      weeklyEntries: { select: { quantity: true, type: true } },
    },
  });

  const [reserves, sezonProducedMap] = await Promise.all([
    prisma.stockReserve.findMany({
      where: {
        iwasku: { in: iwaskus },
        pool: { poolType: 'SEASONAL' },
        status: { not: 'CANCELLED' },
      },
      select: {
        iwasku: true,
        initialStock: true,
        shippedQuantity: true,
      },
    }),
    getSezonProducedByIwasku(iwaskus),
  ]);

  const reserveMap = new Map<string, number>();
  for (const r of reserves) {
    const reserved = r.initialStock - r.shippedQuantity;
    if (reserved <= 0) continue;
    reserveMap.set(r.iwasku, (reserveMap.get(r.iwasku) ?? 0) + reserved);
  }
  for (const [iwasku, produced] of sezonProducedMap) {
    if (produced <= 0) continue;
    reserveMap.set(iwasku, (reserveMap.get(iwasku) ?? 0) + produced);
  }

  const shipItems = await prisma.shipmentItem.groupBy({
    by: ['iwasku'],
    where: { iwasku: { in: iwaskus }, packed: true, sentAt: null },
    _sum: { quantity: true },
  });
  const shipmentReservedMap = new Map<string, number>();
  for (const s of shipItems) {
    shipmentReservedMap.set(s.iwasku, s._sum.quantity ?? 0);
  }

  return iwaskus.map(iwasku => {
    const wp = warehouseProducts.find(w => w.iwasku === iwasku);
    if (!wp) {
      return { iwasku, mevcut: 0, reserved: 0, shipmentReserved: 0, atp: 0 };
    }

    const weeklyProduction = wp.weeklyEntries
      .filter(e => e.type === 'PRODUCTION')
      .reduce((sum, e) => sum + e.quantity, 0);
    const weeklyShipment = wp.weeklyEntries
      .filter(e => e.type === 'SHIPMENT')
      .reduce((sum, e) => sum + e.quantity, 0);

    const mevcut = wp.eskiStok + wp.ilaveStok + weeklyProduction - wp.cikis - weeklyShipment;
    const shipmentReserved = Math.max(0, shipmentReservedMap.get(iwasku) ?? 0);
    // Reserve mevcut'u aşamaz — cap ile gerçek tutulan miktarı raporla
    const reservedRaw = Math.max(0, reserveMap.get(iwasku) ?? 0);
    const reservedCap = Math.max(0, mevcut - shipmentReserved);
    const reserved = Math.min(reservedRaw, reservedCap);
    const atp = Math.max(0, mevcut - reserved - shipmentReserved);

    return { iwasku, mevcut, reserved, shipmentReserved, atp };
  });
}

export async function getATPAll(): Promise<ATPResult[]> {
  const allProducts = await prisma.warehouseProduct.findMany({
    select: { iwasku: true },
  });
  const iwaskus = allProducts.map(p => p.iwasku);
  return getATPBulk(iwaskus);
}

export async function getATPMap(iwaskus?: string[]): Promise<Map<string, ATPResult>> {
  const results = iwaskus ? await getATPBulk(iwaskus) : await getATPAll();
  return new Map(results.map(r => [r.iwasku, r]));
}
