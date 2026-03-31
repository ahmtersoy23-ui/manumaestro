/**
 * Auto-complete/revert production requests based on snapshot stock vs live demand.
 *
 * Uses ATP (Available to Promise) instead of raw stock:
 *   ATP = warehouseStock - seasonalReserves
 *
 * Supports marketplace priority (waterfall completion):
 *   If priorities are set for the month, requests are completed in priority order.
 *   e.g., AU (priority 1) gets completed first, then US (priority 2), etc.
 */

import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';
import { getATPBulk } from '@/lib/db/atp';

const logger = createLogger('AutoComplete');

export async function autoCompleteFromSnapshot(month: string): Promise<number> {
  // 1. Get snapshot stock (fixed values)
  const snapshots = await prisma.monthSnapshot.findMany({
    where: { month },
  });

  if (snapshots.length === 0) return 0;

  const snapshotStockMap = new Map<string, number>();
  for (const s of snapshots) {
    snapshotStockMap.set(s.iwasku, s.warehouseStock);
  }

  // 2. Calculate ATP: snapshot stock - seasonal reserves
  const iwaskus = [...snapshotStockMap.keys()];
  const atpResults = await getATPBulk(iwaskus);
  const reserveMap = new Map(atpResults.map(a => [a.iwasku, a.reserved]));

  const atpMap = new Map<string, number>();
  for (const [iwasku, stock] of snapshotStockMap) {
    const reserved = reserveMap.get(iwasku) ?? 0;
    atpMap.set(iwasku, Math.max(0, stock - reserved));
  }

  // 3. Get marketplace priorities for this month (if set)
  const priorities = await prisma.marketplacePriority.findMany({
    where: { month },
    orderBy: { priority: 'asc' },
  });
  const priorityMap = new Map(priorities.map(p => [p.marketplaceId, p.priority]));
  const hasPriorities = priorities.length > 0;

  // 4. Get current live demand per IWASKU + marketplace for this month
  const requests = await prisma.productionRequest.findMany({
    where: { productionMonth: month },
    select: {
      id: true,
      iwasku: true,
      marketplaceId: true,
      quantity: true,
      status: true,
      manufacturerNotes: true,
    },
  });

  let totalChanged = 0;

  if (hasPriorities) {
    // === WATERFALL COMPLETION (priority-based) ===
    // Group requests by iwasku, then sort by marketplace priority
    const byIwasku = new Map<string, typeof requests>();
    for (const r of requests) {
      const list = byIwasku.get(r.iwasku) ?? [];
      list.push(r);
      byIwasku.set(r.iwasku, list);
    }

    for (const [iwasku, reqs] of byIwasku) {
      const atp = atpMap.get(iwasku) ?? 0;

      // Sort by priority (lower number = higher priority)
      const sorted = reqs.sort((a, b) => {
        const pa = priorityMap.get(a.marketplaceId) ?? 999;
        const pb = priorityMap.get(b.marketplaceId) ?? 999;
        return pa - pb;
      });

      // Waterfall: allocate ATP to marketplaces in priority order
      let remaining = atp;
      for (const req of sorted) {
        if (remaining >= req.quantity) {
          // This marketplace's demand is covered
          remaining -= req.quantity;
          if (req.status === 'REQUESTED') {
            await prisma.productionRequest.update({
              where: { id: req.id },
              data: { status: 'COMPLETED', manufacturerNotes: 'Stoktan karşılandı' },
            });
            totalChanged++;
          }
        } else {
          // Not enough ATP for this marketplace
          if (req.status === 'COMPLETED' && req.manufacturerNotes === 'Stoktan karşılandı') {
            await prisma.productionRequest.update({
              where: { id: req.id },
              data: { status: 'REQUESTED', manufacturerNotes: null },
            });
            totalChanged++;
          }
        }
      }
    }
  } else {
    // === LEGACY BEHAVIOR (aggregate per iwasku, no priority) ===
    const demandGroups = await prisma.productionRequest.groupBy({
      by: ['iwasku'],
      where: { productionMonth: month },
      _sum: { quantity: true },
    });

    const coveredIwaskus: string[] = [];
    const uncoveredIwaskus: string[] = [];

    for (const r of demandGroups) {
      const demand = r._sum.quantity || 0;
      const atp = atpMap.get(r.iwasku) ?? 0;
      if (atp >= demand) {
        coveredIwaskus.push(r.iwasku);
      } else {
        uncoveredIwaskus.push(r.iwasku);
      }
    }

    // Auto-complete: REQUESTED → COMPLETED (ATP covers demand)
    if (coveredIwaskus.length > 0) {
      const completed = await prisma.productionRequest.updateMany({
        where: {
          productionMonth: month,
          iwasku: { in: coveredIwaskus },
          status: 'REQUESTED',
        },
        data: {
          status: 'COMPLETED',
          manufacturerNotes: 'Stoktan karşılandı',
        },
      });
      if (completed.count > 0) {
        logger.info(`Auto-completed ${completed.count} requests for ${month}`);
        totalChanged += completed.count;
      }
    }

    // Revert: COMPLETED → REQUESTED (ATP no longer covers)
    if (uncoveredIwaskus.length > 0) {
      const reverted = await prisma.productionRequest.updateMany({
        where: {
          productionMonth: month,
          iwasku: { in: uncoveredIwaskus },
          status: 'COMPLETED',
          manufacturerNotes: 'Stoktan karşılandı',
        },
        data: {
          status: 'REQUESTED',
          manufacturerNotes: null,
        },
      });
      if (reverted.count > 0) {
        logger.info(`Reverted ${reverted.count} requests for ${month} (ATP no longer sufficient)`);
        totalChanged += reverted.count;
      }
    }
  }

  return totalChanged;
}
