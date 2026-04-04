/**
 * Shared helpers for export endpoints.
 * Extracts duplicated MonthSnapshot queries into reusable functions.
 */

import { prisma } from '@/lib/db/prisma';

/**
 * Fetches the produced quantity per IWASKU from MonthSnapshot for a given month.
 * Returns an empty map if month is falsy.
 */
export async function getProducedMap(month: string | null | undefined): Promise<Map<string, number>> {
  if (!month) return new Map();

  const snapshots = await prisma.monthSnapshot.findMany({
    where: { month },
    select: { iwasku: true, produced: true },
  });
  return new Map(snapshots.map(s => [s.iwasku, s.produced]));
}

/**
 * Fetches the warehouse stock per IWASKU from MonthSnapshot for a given month.
 * Returns an empty map if month is falsy.
 */
export async function getSnapshotStockMap(month: string | null | undefined): Promise<Map<string, number>> {
  if (!month) return new Map();

  const snapshots = await prisma.monthSnapshot.findMany({
    where: { month },
    select: { iwasku: true, warehouseStock: true },
  });
  return new Map(snapshots.map(s => [s.iwasku, s.warehouseStock]));
}
