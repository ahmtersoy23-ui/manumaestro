/**
 * ATP (Available to Promise) calculation
 *
 * ATP = Total warehouse stock - Seasonal reserved stock
 *
 * Total stock (mevcut) = eskiStok + ilaveStok + weeklyProduction - cikis - weeklyShipment
 * Reserved = SUM(stock_reserves.initialStock + stock_reserves.producedQuantity - stock_reserves.shippedQuantity)
 *            WHERE pool is SEASONAL AND (initialStock > 0 OR producedQuantity > 0)
 */

import { prisma } from './prisma';

export interface ATPResult {
  iwasku: string;
  mevcut: number;    // Total physical stock
  reserved: number;  // Seasonal reserved stock
  atp: number;       // Available to promise
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

  // Get seasonal reserves (initialStock + producedQuantity = total season stock)
  const reserves = await prisma.stockReserve.findMany({
    where: {
      iwasku: { in: iwaskus },
      pool: { poolType: 'SEASONAL' },
      OR: [
        { initialStock: { gt: 0 } },
        { producedQuantity: { gt: 0 } },
      ],
    },
    select: {
      iwasku: true,
      initialStock: true,
      producedQuantity: true,
      shippedQuantity: true,
    },
  });

  // Build reserve map: reserved = initialStock + producedQuantity - shippedQuantity
  const reserveMap = new Map<string, number>();
  for (const r of reserves) {
    const current = reserveMap.get(r.iwasku) ?? 0;
    reserveMap.set(r.iwasku, current + (r.initialStock + r.producedQuantity - r.shippedQuantity));
  }

  // Calculate ATP for each product
  return iwaskus.map(iwasku => {
    const wp = warehouseProducts.find(w => w.iwasku === iwasku);
    if (!wp) {
      return { iwasku, mevcut: 0, reserved: 0, atp: 0 };
    }

    const weeklyProduction = wp.weeklyEntries
      .filter(e => e.type === 'PRODUCTION')
      .reduce((sum, e) => sum + e.quantity, 0);

    const weeklyShipment = wp.weeklyEntries
      .filter(e => e.type === 'SHIPMENT')
      .reduce((sum, e) => sum + e.quantity, 0);

    const mevcut = wp.eskiStok + wp.ilaveStok + weeklyProduction - wp.cikis - weeklyShipment;
    const reserved = Math.max(0, reserveMap.get(iwasku) ?? 0);
    const atp = Math.max(0, mevcut - reserved);

    return { iwasku, mevcut, reserved, atp };
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
