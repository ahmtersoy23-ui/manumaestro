/**
 * Ankara depo totals (TOTALS_PRIMARY mod).
 * mevcut = eskiStok + ilaveStok - cikis + sum(weekly PRODUCTION) - sum(weekly SHIPMENT)
 * Bu formül /api/admin/warehouse-stock'taki hesabın özet hâlidir.
 */

import { prisma } from '@/lib/db/prisma';

export async function getAnkaraTotals(): Promise<{ totalQty: number; productCount: number }> {
  const [products, weeklyAgg] = await Promise.all([
    prisma.warehouseProduct.aggregate({
      _sum: { eskiStok: true, ilaveStok: true, cikis: true },
      _count: true,
    }),
    prisma.warehouseWeekly.groupBy({
      by: ['type'],
      _sum: { quantity: true },
    }),
  ]);

  const eski = products._sum.eskiStok ?? 0;
  const ilave = products._sum.ilaveStok ?? 0;
  const cikis = products._sum.cikis ?? 0;
  const prod = weeklyAgg.find((w) => w.type === 'PRODUCTION')?._sum.quantity ?? 0;
  const ship = weeklyAgg.find((w) => w.type === 'SHIPMENT')?._sum.quantity ?? 0;

  return {
    totalQty: eski + ilave - cikis + prod - ship,
    productCount: products._count,
  };
}
