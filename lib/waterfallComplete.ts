/**
 * Waterfall Completion — Priority-based distribution
 *
 * Combines snapshot stock (depot) + manufacturer produced to determine status.
 * Distributes totalAvailable across marketplace requests by priority.
 *
 * Status rules:
 *   allocated >= quantity           → COMPLETED
 *   allocated > 0 && < quantity     → PARTIALLY_PRODUCED
 *   allocated = 0 && was auto-set   → REQUESTED (revert)
 *   allocated = 0 && manual          → don't touch
 */

import { prisma } from '@/lib/db/prisma';
import { RequestStatus } from '@prisma/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WaterfallComplete');

const AUTO_NOTES = ['Öncelik tamamlandı', 'Stoktan karşılandı'];

export async function waterfallComplete(iwasku: string, month: string): Promise<number> {
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

  // Snapshot stock (depot perspective, season reserved already subtracted)
  const snapshot = await prisma.monthSnapshot.findUnique({
    where: { month_iwasku: { month, iwasku } },
  });
  const snapshotStock = snapshot?.warehouseStock ?? 0;

  // Manufacturer reported production (product-level, MAX across requests)
  const totalProduced = Math.max(...allRequests.map(r => r.producedQuantity ?? 0));

  // Combined available = what's physically reachable
  const totalAvailable = snapshotStock + totalProduced;

  // Marketplace priorities
  const priorities = await prisma.marketplacePriority.findMany({
    where: { month },
    orderBy: { priority: 'asc' },
  });

  if (priorities.length === 0) return 0;

  const priorityMap = new Map(priorities.map(p => [p.marketplaceId, p.priority]));

  const sorted = [...allRequests].sort((a, b) => {
    const pa = priorityMap.get(a.marketplaceId) ?? 999;
    const pb = priorityMap.get(b.marketplaceId) ?? 999;
    return pa - pb;
  });

  // Distribute by priority
  let remaining = totalAvailable;
  let changed = 0;

  for (const req of sorted) {
    const allocated = Math.min(req.quantity, Math.max(0, remaining));
    remaining -= allocated;

    // Determine target status from allocated amount
    let targetStatus: RequestStatus;
    if (allocated >= req.quantity) {
      targetStatus = RequestStatus.COMPLETED;
    } else if (allocated > 0) {
      targetStatus = RequestStatus.PARTIALLY_PRODUCED;
    } else {
      // No allocation — revert only if we auto-set this before
      const isAutoManaged = AUTO_NOTES.includes(req.manufacturerNotes ?? '');
      if ((req.status === 'COMPLETED' || req.status === 'PARTIALLY_PRODUCED') && isAutoManaged) {
        targetStatus = RequestStatus.REQUESTED;
      } else {
        continue; // Manual or already correct — skip
      }
    }

    const statusChanged = req.status !== targetStatus;
    const producedChanged = (req.producedQuantity ?? 0) !== allocated;

    if (statusChanged || producedChanged) {
      await prisma.productionRequest.update({
        where: { id: req.id },
        data: {
          producedQuantity: allocated,
          status: targetStatus,
          manufacturerNotes: allocated > 0 ? 'Öncelik tamamlandı' : null,
        },
      });
      changed++;
    }
  }

  if (changed > 0) {
    logger.info(`Waterfall: ${iwasku} (${month}) — stok:${snapshotStock} + üretilen:${totalProduced} = ${totalAvailable}, ${changed} güncellendi`);
  }

  return changed;
}
