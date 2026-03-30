/**
 * Auto-complete/revert production requests based on snapshot stock vs live demand.
 * - Stock >= demand → REQUESTED items become COMPLETED ("Stoktan karşılandı")
 * - Stock < demand → Previously auto-completed items revert to REQUESTED
 */

import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AutoComplete');

export async function autoCompleteFromSnapshot(month: string): Promise<number> {
  // 1. Get snapshot stock (fixed values)
  const snapshots = await prisma.monthSnapshot.findMany({
    where: { month },
  });

  if (snapshots.length === 0) return 0;

  const stockMap = new Map<string, number>();
  for (const s of snapshots) {
    stockMap.set(s.iwasku, s.warehouseStock);
  }

  // 2. Get current live demand per IWASKU for this month
  const demandGroups = await prisma.productionRequest.groupBy({
    by: ['iwasku'],
    where: { productionMonth: month },
    _sum: { quantity: true },
  });

  const coveredIwaskus: string[] = [];
  const uncoveredIwaskus: string[] = [];

  for (const r of demandGroups) {
    const demand = r._sum.quantity || 0;
    const stock = stockMap.get(r.iwasku) || 0;
    if (stock >= demand) {
      coveredIwaskus.push(r.iwasku);
    } else {
      uncoveredIwaskus.push(r.iwasku);
    }
  }

  let totalChanged = 0;

  // 3. Auto-complete: REQUESTED → COMPLETED (stock covers demand)
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

  // 4. Revert: COMPLETED ("Stoktan karşılandı") → REQUESTED (stock no longer covers)
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
      logger.info(`Reverted ${reverted.count} requests for ${month} (stock no longer sufficient)`);
      totalChanged += reverted.count;
    }
  }

  return totalChanged;
}
