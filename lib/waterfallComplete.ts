/**
 * Waterfall Completion — Priority-based status distribution
 *
 * Reads from MonthSnapshot (single source of truth):
 *   totalAvailable = warehouseStock + produced
 *
 * Status rules:
 *   totalAvailable >= totalRequested → ALL requests COMPLETED
 *   totalAvailable < totalRequested && produced > 0 → priority distribution:
 *     - Fill marketplace requests in priority order
 *     - Filled → COMPLETED (tik), partially filled → PARTIALLY_PRODUCED, unfilled → REQUESTED
 *   produced = 0 && warehouseStock = 0 → all REQUESTED
 */

import { prisma } from '@/lib/db/prisma';
import { RequestStatus } from '@prisma/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WaterfallComplete');

export async function waterfallComplete(iwasku: string, month: string): Promise<number> {
  // 1. Read from MonthSnapshot
  const snapshot = await prisma.monthSnapshot.findUnique({
    where: { month_iwasku: { month, iwasku } },
  });

  if (!snapshot) return 0;

  const totalAvailable = snapshot.warehouseStock + snapshot.produced;

  // 2. Get all requests + priorities
  const allRequests = await prisma.productionRequest.findMany({
    where: { iwasku, productionMonth: month },
    select: { id: true, marketplaceId: true, quantity: true, status: true },
  });

  if (allRequests.length === 0) return 0;

  // 3. Simple cases: all COMPLETED or all REQUESTED
  if (totalAvailable >= snapshot.totalRequested) {
    const result = await prisma.productionRequest.updateMany({
      where: { iwasku, productionMonth: month, status: { not: RequestStatus.COMPLETED } },
      data: { status: RequestStatus.COMPLETED },
    });
    if (result.count > 0) logger.info(`Waterfall: ${iwasku} (${month}) — ${totalAvailable}/${snapshot.totalRequested} → ALL COMPLETED`);
    return result.count;
  }

  if (snapshot.produced === 0 && snapshot.warehouseStock === 0) {
    const result = await prisma.productionRequest.updateMany({
      where: { iwasku, productionMonth: month, status: { not: RequestStatus.REQUESTED } },
      data: { status: RequestStatus.REQUESTED },
    });
    return result.count;
  }

  // 4. Partial: distribute by marketplace priority
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

  // Calculate target status for each request, group by status for batch update
  let remaining = totalAvailable;
  const completedIds: string[] = [];
  const partialIds: string[] = [];
  const requestedIds: string[] = [];

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
      if (targetStatus === RequestStatus.COMPLETED) completedIds.push(req.id);
      else if (targetStatus === RequestStatus.PARTIALLY_PRODUCED) partialIds.push(req.id);
      else requestedIds.push(req.id);
    }
  }

  // Batch updates: max 3 queries instead of N
  let changed = 0;
  if (completedIds.length > 0) {
    const r = await prisma.productionRequest.updateMany({ where: { id: { in: completedIds } }, data: { status: RequestStatus.COMPLETED } });
    changed += r.count;
  }
  if (partialIds.length > 0) {
    const r = await prisma.productionRequest.updateMany({ where: { id: { in: partialIds } }, data: { status: RequestStatus.PARTIALLY_PRODUCED } });
    changed += r.count;
  }
  if (requestedIds.length > 0) {
    const r = await prisma.productionRequest.updateMany({ where: { id: { in: requestedIds } }, data: { status: RequestStatus.REQUESTED } });
    changed += r.count;
  }

  if (changed > 0) {
    logger.info(`Waterfall: ${iwasku} (${month}) — stok:${snapshot.warehouseStock} + üretilen:${snapshot.produced} = ${totalAvailable}/${snapshot.totalRequested}, ${changed} güncellendi`);
  }

  return changed;
}
