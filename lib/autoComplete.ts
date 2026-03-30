/**
 * Auto-complete production requests where snapshot stock covers demand.
 * Uses FIXED snapshot stock vs LIVE request totals.
 * Only affects REQUESTED status items.
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

  // 3. Find IWASKUs where stock covers full demand
  const coveredIwaskus = demandGroups
    .filter(r => {
      const demand = r._sum.quantity || 0;
      const stock = stockMap.get(r.iwasku) || 0;
      return stock >= demand;
    })
    .map(r => r.iwasku);

  if (coveredIwaskus.length === 0) return 0;

  // 4. Auto-complete only REQUESTED status
  const result = await prisma.productionRequest.updateMany({
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

  if (result.count > 0) {
    logger.info(`Auto-completed ${result.count} requests for ${month} (stock sufficient)`);
  }

  return result.count;
}
