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
 * @returns number of requests changed
 */
export async function waterfallComplete(iwasku: string, month: string): Promise<number> {
  // 1. Get total produced for this iwasku in this month
  //    Sum of producedQuantity across ALL requests for this iwasku/month
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

  // Total produced = SUM of producedQuantity across all requests for this iwasku
  // Manufacturer panel distributes produced qty across marketplace requests
  const totalProduced = allRequests.reduce(
    (sum, r) => sum + (r.producedQuantity ?? 0), 0
  );

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

  // 4. Waterfall: allocate produced quantity in priority order
  let remaining = totalProduced;
  let changed = 0;

  for (const req of sorted) {
    if (remaining >= req.quantity) {
      // This marketplace's demand is fully covered
      remaining -= req.quantity;

      if (req.status !== 'COMPLETED' || req.manufacturerNotes !== 'Öncelik tamamlandı') {
        // Only update if not already marked by us
        if (req.status === 'REQUESTED' || req.status === 'PARTIALLY_PRODUCED' ||
            (req.status === 'COMPLETED' && req.manufacturerNotes !== 'Öncelik tamamlandı')) {
          await prisma.productionRequest.update({
            where: { id: req.id },
            data: {
              status: 'COMPLETED',
              manufacturerNotes: 'Öncelik tamamlandı',
            },
          });
          changed++;
        }
      }
    } else {
      // Not enough produced for this marketplace
      if (req.status === 'COMPLETED' && req.manufacturerNotes === 'Öncelik tamamlandı') {
        // Was previously auto-completed, revert
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
    logger.info(`Waterfall: ${iwasku} (${month}) — ${totalProduced} üretilen, ${changed} talep güncellendi`);
  }

  return changed;
}
