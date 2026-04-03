/**
 * Waterfall Completion — Priority-based status management
 *
 * Reads from MonthSnapshot (single source of truth):
 *   totalAvailable = warehouseStock + produced
 *
 * Status rules:
 *   totalAvailable >= totalRequested → ALL requests COMPLETED
 *   totalAvailable < totalRequested && produced > 0 → priority distribution:
 *     - Marketplace requests filled in priority order
 *     - Filled → COMPLETED, partially filled → PARTIALLY_PRODUCED, unfilled → REQUESTED
 *   produced = 0 → all REQUESTED
 *
 * Does NOT write producedQuantity — only status changes.
 */

import { prisma } from '@/lib/db/prisma';
import { RequestStatus } from '@prisma/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WaterfallComplete');

export async function waterfallComplete(iwasku: string, month: string): Promise<number> {
  // 1. Read from MonthSnapshot (single source of truth)
  const snapshot = await prisma.monthSnapshot.findUnique({
    where: { month_iwasku: { month, iwasku } },
  });

  if (!snapshot) return 0;

  const totalAvailable = snapshot.warehouseStock + snapshot.produced;
  const { totalRequested, produced } = snapshot;

  // 2. Get all requests for this product+month
  const allRequests = await prisma.productionRequest.findMany({
    where: { iwasku, productionMonth: month },
    select: { id: true, marketplaceId: true, quantity: true, status: true },
  });

  if (allRequests.length === 0) return 0;

  // 3. Get marketplace priorities
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

  // 4. Determine status for each request
  let changed = 0;

  if (produced === 0 && snapshot.warehouseStock === 0) {
    // Nothing available → all REQUESTED
    for (const req of sorted) {
      if (req.status !== 'REQUESTED') {
        await prisma.productionRequest.update({
          where: { id: req.id },
          data: { status: RequestStatus.REQUESTED },
        });
        changed++;
      }
    }
  } else if (totalAvailable >= totalRequested) {
    // Everything covered → all COMPLETED
    for (const req of sorted) {
      if (req.status !== 'COMPLETED') {
        await prisma.productionRequest.update({
          where: { id: req.id },
          data: { status: RequestStatus.COMPLETED },
        });
        changed++;
      }
    }
  } else {
    // Partial: distribute by priority
    let remaining = totalAvailable;

    for (const req of sorted) {
      let targetStatus: RequestStatus;

      if (remaining >= req.quantity) {
        remaining -= req.quantity;
        targetStatus = RequestStatus.COMPLETED;
      } else if (remaining > 0) {
        remaining = 0;
        targetStatus = RequestStatus.PARTIALLY_PRODUCED;
      } else {
        targetStatus = RequestStatus.REQUESTED;
      }

      if (req.status !== targetStatus) {
        await prisma.productionRequest.update({
          where: { id: req.id },
          data: { status: targetStatus },
        });
        changed++;
      }
    }
  }

  if (changed > 0) {
    logger.info(`Waterfall: ${iwasku} (${month}) — stok:${snapshot.warehouseStock} + üretilen:${produced} = ${totalAvailable}/${totalRequested}, ${changed} güncellendi`);
  }

  return changed;
}
