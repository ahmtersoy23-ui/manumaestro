/**
 * ATP (Available to Promise) calculation
 *
 * ATP = Total warehouse stock - Seasonal reserved - Shipment reserved
 *
 * Total stock (mevcut)       = eskiStok + ilaveStok + weeklyProduction - cikis - weeklyShipment
 * Seasonal reserved          = SUM(initialStock - shippedQuantity) per SEASONAL pool
 * Shipment reserved (Ankara) = SUM(shipment_items.quantity) WHERE packed AND sent_at IS NULL
 *                              (kolilenmiş ama henüz sevk edilmemiş — Ankara'dan çıkacak miktar)
 */

import { prisma } from './prisma';

export interface ATPResult {
  iwasku: string;
  mevcut: number;            // Total physical stock
  reserved: number;          // Seasonal reserved stock
  shipmentReserved: number;  // Packed but not yet shipped
  atp: number;               // Available to promise
}

/**
 * Calculate ATP for a single product
 */
export async function getATP(iwasku: string): Promise<ATPResult> {
  const results = await getATPBulk([iwasku]);
  return results[0] ?? { iwasku, mevcut: 0, reserved: 0, atp: 0 };
}

/**
 * Calculate ATP for multiple products
 */
export async function getATPBulk(iwaskus: string[]): Promise<ATPResult[]> {
  if (iwaskus.length === 0) return [];

  // Get warehouse stock with weekly entries
  const warehouseProducts = await prisma.warehouseProduct.findMany({
    where: { iwasku: { in: iwaskus } },
    include: {
      weeklyEntries: {
        select: { quantity: true, type: true },
      },
    },
  });

  // Get seasonal reserves (only initialStock — pre-assigned depot stock)
  // producedQuantity is NOT included: new production goes to monthly demands first,
  // season accounting is handled via batch reconciliation separately.
  const reserves = await prisma.stockReserve.findMany({
    where: {
      iwasku: { in: iwaskus },
      pool: { poolType: 'SEASONAL' },
      initialStock: { gt: 0 },
    },
    select: {
      iwasku: true,
      initialStock: true,
      shippedQuantity: true,
    },
  });

  // Build reserve map: reserved = initialStock - shippedQuantity
  const reserveMap = new Map<string, number>();
  for (const r of reserves) {
    const current = reserveMap.get(r.iwasku) ?? 0;
    reserveMap.set(r.iwasku, current + (r.initialStock - r.shippedQuantity));
  }

  // Sevkiyat rezerve: kolilenmiş (packed=true) ama henüz sevk edilmemiş (sentAt=null)
  // shipment_items aggregation — tek source of truth, kalıcı kolon yok.
  // Şu an tüm sevkiyatlar Ankara çıkışlı kabul ediliyor; ileride Shipment.warehouseFrom
  // eklendiğinde buraya filter eklenir.
  const shipItems = await prisma.shipmentItem.groupBy({
    by: ['iwasku'],
    where: {
      iwasku: { in: iwaskus },
      packed: true,
      sentAt: null,
    },
    _sum: { quantity: true },
  });
  const shipmentReservedMap = new Map<string, number>();
  for (const s of shipItems) {
    shipmentReservedMap.set(s.iwasku, s._sum.quantity ?? 0);
  }

  // Calculate ATP for each product
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
    const reserved = Math.max(0, reserveMap.get(iwasku) ?? 0);
    const shipmentReserved = Math.max(0, shipmentReservedMap.get(iwasku) ?? 0);
    const atp = Math.max(0, mevcut - reserved - shipmentReserved);

    return { iwasku, mevcut, reserved, shipmentReserved, atp };
  });
}

/**
 * Calculate ATP for ALL warehouse products (used by warehouse stock page)
 */
export async function getATPAll(): Promise<ATPResult[]> {
  const allProducts = await prisma.warehouseProduct.findMany({
    select: { iwasku: true },
  });
  const iwaskus = allProducts.map(p => p.iwasku);
  return getATPBulk(iwaskus);
}

/**
 * Get ATP as a map (iwasku -> atp) for quick lookups
 */
export async function getATPMap(iwaskus?: string[]): Promise<Map<string, ATPResult>> {
  const results = iwaskus ? await getATPBulk(iwaskus) : await getATPAll();
  return new Map(results.map(r => [r.iwasku, r]));
}
