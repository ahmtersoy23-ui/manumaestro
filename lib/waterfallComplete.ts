/**
 * Waterfall Completion — Product-level status
 *
 * Reads from MonthSnapshot (single source of truth):
 *   totalAvailable = warehouseStock + produced
 *
 * Product-level status (written to ALL requests for this iwasku+month):
 *   totalAvailable >= totalRequested  → COMPLETED
 *   produced > 0                      → PARTIALLY_PRODUCED
 *   produced = 0                      → REQUESTED
 *
 * Marketplace tik'leri (priority-based) are computed on-the-fly for display,
 * NOT stored on individual requests.
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

  // 2. Determine PRODUCT-LEVEL status
  let targetStatus: RequestStatus;
  if (totalAvailable >= snapshot.totalRequested) {
    targetStatus = RequestStatus.COMPLETED;
  } else if (snapshot.produced > 0) {
    targetStatus = RequestStatus.PARTIALLY_PRODUCED;
  } else {
    targetStatus = RequestStatus.REQUESTED;
  }

  // 3. Apply to ALL requests for this product+month
  const result = await prisma.productionRequest.updateMany({
    where: {
      iwasku,
      productionMonth: month,
      status: { not: targetStatus },
    },
    data: { status: targetStatus },
  });

  if (result.count > 0) {
    logger.info(`Waterfall: ${iwasku} (${month}) — stok:${snapshot.warehouseStock} + üretilen:${snapshot.produced} = ${totalAvailable}/${snapshot.totalRequested} → ${targetStatus}, ${result.count} güncellendi`);
  }

  return result.count;
}
