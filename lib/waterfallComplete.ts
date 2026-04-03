/**
 * Waterfall Completion
 *
 * When producedQuantity changes for an IWASKU in a given month,
 * automatically mark marketplace requests as COMPLETED in priority order.
 *
 * Example: Takealot (5, priority 1), Walmart (5, priority 2), Kaufland (8, priority 3)
 *   producedQuantity = 5  → Takealot ✅
 *   producedQuantity = 10 → Takealot ✅ + Walmart ✅
 *   producedQuantity = 18 → all ✅
 *   producedQuantity = 8  → Takealot ✅ + Walmart partial (reverts Kaufland)
 */

import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WaterfallComplete');

/**
 * Run waterfall completion for a specific iwasku + month.
 * Called after producedQuantity is updated in manufacturer panel.
 *
 * Available = warehouse stock (mevcut) + total produced
 * Waterfall allocates this available qty to marketplaces in priority order.
 *
 * @returns number of requests changed
 */
export async function waterfallComplete(iwasku: string, month: string): Promise<number> {
  // 1. Get all requests for this iwasku in this month
  const allRequests = await prisma.productionRequest.findMany({
    where: { iwasku, productionMonth: month },
    select: {
      id: true,
      marketplaceId: true,
      quantity: true,
      producedQuantity: true,
      status: true,
      manufacturerNotes: true,
    },
  });

  if (allRequests.length === 0) return 0;

  // 2. Get snapshot stock (frozen at month boundary, not live stock)
  const snapshot = await prisma.monthSnapshot.findUnique({
    where: { month_iwasku: { month, iwasku } },
  });
  const warehouseStock = snapshot?.warehouseStock ?? 0;

  // 3. Subtract season reserved stock (initialStock is earmarked, not available for monthly)
  const seasonReserve = await prisma.stockReserve.findFirst({
    where: { iwasku, pool: { poolType: 'SEASONAL' }, status: { not: 'CANCELLED' } },
    select: { initialStock: true, producedQuantity: true, shippedQuantity: true },
  });
  const seasonReserved = seasonReserve
    ? Math.max(0, seasonReserve.initialStock + seasonReserve.producedQuantity - seasonReserve.shippedQuantity)
    : 0;

  // 4. Total produced from manufacturer panel (MAX — stored on first request)
  const totalProduced = Math.max(
    ...allRequests.map(r => r.producedQuantity ?? 0)
  );

  // 5. Available = stock + produced - season reserved
  const totalAvailable = Math.max(0, warehouseStock + totalProduced - seasonReserved);

  // 2. Get marketplace priorities for this month
  const priorities = await prisma.marketplacePriority.findMany({
    where: { month },
    orderBy: { priority: 'asc' },
  });

  if (priorities.length === 0) {
    // No priorities set — don't do waterfall
    return 0;
  }

  const priorityMap = new Map(priorities.map(p => [p.marketplaceId, p.priority]));

  // 3. Sort requests by marketplace priority
  const sorted = [...allRequests].sort((a, b) => {
    const pa = priorityMap.get(a.marketplaceId) ?? 999;
    const pb = priorityMap.get(b.marketplaceId) ?? 999;
    return pa - pb;
  });

  // 5. Waterfall: allocate available quantity STRICTLY in priority order
  //    Once a marketplace can't be fulfilled, STOP — don't skip to lower priorities
  //    This ensures priority order is respected: if #2 can't be done, #3-#14 don't get done either
  let remaining = totalAvailable;
  let changed = 0;
  let blocked = false; // Once true, no more completions

  for (const req of sorted) {
    if (!blocked && remaining >= req.quantity) {
      // This marketplace's demand is fully covered
      remaining -= req.quantity;

      if (req.status !== 'COMPLETED') {
        await prisma.productionRequest.update({
          where: { id: req.id },
          data: {
            status: 'COMPLETED',
            manufacturerNotes: 'Öncelik tamamlandı',
          },
        });
        changed++;
      } else if (req.manufacturerNotes === 'Stoktan karşılandı') {
        await prisma.productionRequest.update({
          where: { id: req.id },
          data: { manufacturerNotes: 'Öncelik tamamlandı' },
        });
      }
    } else {
      // Can't fulfill this priority — block all lower priorities too
      blocked = true;

      if (req.status === 'COMPLETED' &&
          (req.manufacturerNotes === 'Öncelik tamamlandı' || req.manufacturerNotes === 'Stoktan karşılandı')) {
        await prisma.productionRequest.update({
          where: { id: req.id },
          data: {
            status: 'REQUESTED',
            manufacturerNotes: null,
          },
        });
        changed++;
      }
    }
  }

  if (changed > 0) {
    logger.info(`Waterfall: ${iwasku} (${month}) — stok:${warehouseStock} + üretilen:${totalProduced} - sezon:${seasonReserved} = ${totalAvailable}, ${changed} talep güncellendi`);
  }

  return changed;
}
