/**
 * Waterfall Completion — Product-level production distribution
 *
 * Production is product-level (IWASKU+month), not marketplace-level.
 * Waterfall distributes total available qty to marketplace requests in priority order,
 * writing both producedQuantity and status to each request.
 *
 * Example: totalAvailable = 25, Takealot (6, pri 1), Amazon AU (30, pri 2), Amazon US (7, pri 3)
 *   Takealot  → produced=6,  COMPLETED (6 ≤ 25, remaining=19)
 *   Amazon AU → produced=19, PARTIALLY_PRODUCED (19 < 30, remaining=0)
 *   Amazon US → produced=0,  unchanged
 *
 * Only auto-managed requests are touched (manufacturerNotes = 'Öncelik tamamlandı' / 'Stoktan karşılandı'
 * or status was auto-set). Manual overrides are preserved.
 */

import { prisma } from '@/lib/db/prisma';
import { RequestStatus } from '@prisma/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WaterfallComplete');

const AUTO_NOTES = ['Öncelik tamamlandı', 'Stoktan karşılandı'];

/**
 * Run waterfall completion for a specific iwasku + month.
 * Distributes totalAvailable (snapshot stock + produced) across requests by priority.
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

  // 2. Total produced = MAX across all requests (production is product-level, manufacturer perspective only)
  //    Depot stock is handled separately by autoCompleteFromSnapshot — these are INDEPENDENT systems.
  const totalAvailable = Math.max(
    ...allRequests.map(r => r.producedQuantity ?? 0)
  );

  // 5. Get marketplace priorities for this month
  const priorities = await prisma.marketplacePriority.findMany({
    where: { month },
    orderBy: { priority: 'asc' },
  });

  if (priorities.length === 0) return 0;

  const priorityMap = new Map(priorities.map(p => [p.marketplaceId, p.priority]));

  // 6. Sort requests by marketplace priority
  const sorted = [...allRequests].sort((a, b) => {
    const pa = priorityMap.get(a.marketplaceId) ?? 999;
    const pb = priorityMap.get(b.marketplaceId) ?? 999;
    return pa - pb;
  });

  // 7. Distribute available qty in priority order + set status accordingly
  let remaining = totalAvailable;
  let changed = 0;

  for (const req of sorted) {
    const allocated = Math.min(req.quantity, Math.max(0, remaining));
    remaining -= allocated;

    // Determine target status
    let targetStatus: RequestStatus;
    let targetNotes: string | null;

    if (allocated >= req.quantity) {
      targetStatus = RequestStatus.COMPLETED;
      targetNotes = 'Öncelik tamamlandı';
    } else if (allocated > 0) {
      targetStatus = RequestStatus.PARTIALLY_PRODUCED;
      targetNotes = 'Öncelik tamamlandı';
    } else {
      // No allocation — only revert if we previously auto-set this request
      if ((req.status === 'COMPLETED' || req.status === 'PARTIALLY_PRODUCED') && AUTO_NOTES.includes(req.manufacturerNotes ?? '')) {
        targetStatus = RequestStatus.REQUESTED;
        targetNotes = null;
      } else {
        continue;
      }
    }

    // Only update if something actually changed
    const statusChanged = req.status !== targetStatus;
    const producedChanged = (req.producedQuantity ?? 0) !== allocated;
    const isAutoManaged = AUTO_NOTES.includes(req.manufacturerNotes ?? '') || req.manufacturerNotes === null;

    // Skip manual overrides: if status was manually set (not auto-notes) and we'd change it
    if (!isAutoManaged && statusChanged && allocated === 0) continue;

    if (statusChanged || producedChanged) {
      await prisma.productionRequest.update({
        where: { id: req.id },
        data: {
          producedQuantity: allocated,
          ...(statusChanged ? { status: targetStatus, manufacturerNotes: targetNotes } : {}),
        },
      });
      changed++;
    }
  }

  if (changed > 0) {
    logger.info(`Waterfall: ${iwasku} (${month}) — üretilen:${totalAvailable}, ${changed} talep güncellendi`);
  }

  return changed;
}
