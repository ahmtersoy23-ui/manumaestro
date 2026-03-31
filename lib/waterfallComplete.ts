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

  // 3. Total produced from manufacturer panel (MAX — stored on first request)
  const totalProduced = Math.max(
    ...allRequests.map(r => r.producedQuantity ?? 0)
  );

  // 4. Available = stock + produced
  const totalAvailable = warehouseStock + totalProduced;

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

  // 5. Waterfall: allocate available quantity in priority order
  //    Takes over ALL auto-completion (replaces old snapshot-based auto-complete)
  let remaining = totalAvailable;
  let changed = 0;

  for (const req of sorted) {
    if (remaining >= req.quantity) {
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
      } else if (req.status === 'COMPLETED' && req.manufacturerNotes === 'Stoktan karşılandı') {
        // Re-label: was snapshot-completed, now waterfall owns it
        await prisma.productionRequest.update({
          where: { id: req.id },
          data: { manufacturerNotes: 'Öncelik tamamlandı' },
        });
      }
    } else {
      // Not enough for this marketplace — revert if previously auto-completed
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
    logger.info(`Waterfall: ${iwasku} (${month}) — stok:${warehouseStock} + üretilen:${totalProduced} = ${totalAvailable}, ${changed} talep güncellendi`);
  }

  return changed;
}
