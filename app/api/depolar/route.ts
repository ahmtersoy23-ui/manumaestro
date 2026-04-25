/**
 * GET /api/depolar
 * Kullanıcının erişebileceği depoları + her birinin temel özet sayılarını döner.
 * Ankara (TOTALS_PRIMARY): WarehouseProduct toplamı.
 * NJ + Showroom (SHELF_PRIMARY): ShelfStock + ShelfBox.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfView } from '@/lib/auth/requireShelfRole';
import { getShelfRole } from '@/lib/auth/shelfPermission';
import { getAnkaraTotals } from '@/lib/warehouse/ankaraTotals';

export async function GET(request: NextRequest) {
  const auth = await requireShelfView(request);
  if (auth instanceof NextResponse) return auth;

  const warehouses = await prisma.warehouse.findMany({
    where: {
      isActive: true,
      code: { in: auth.accessibleWarehouses },
    },
    orderBy: { code: 'asc' },
  });

  const result = await Promise.all(
    warehouses.map(async (w) => {
      const role = await getShelfRole(auth.user.id, auth.user.role, w.code);
      const [shelfCount, pendingUnmatched] = await Promise.all([
        prisma.shelf.count({ where: { warehouseCode: w.code, isActive: true } }),
        prisma.unmatchedSeedRow.count({
          where: { warehouseCode: w.code, status: 'PENDING' },
        }),
      ]);

      let summary;
      if (w.stockMode === 'TOTALS_PRIMARY') {
        // Ankara: WarehouseProduct totals
        const totals = await getAnkaraTotals();
        summary = {
          mode: 'TOTALS_PRIMARY' as const,
          shelfCount,
          totalQty: totals.totalQty,
          productCount: totals.productCount,
          pendingUnmatched,
        };
      } else {
        // NJ / Showroom: ShelfStock + ShelfBox
        const [stockAgg, boxAgg] = await Promise.all([
          prisma.shelfStock.aggregate({
            where: { warehouseCode: w.code },
            _sum: { quantity: true },
            _count: true,
          }),
          prisma.shelfBox.aggregate({
            where: { warehouseCode: w.code, status: { not: 'EMPTY' } },
            _sum: { quantity: true },
            _count: true,
          }),
        ]);
        summary = {
          mode: 'SHELF_PRIMARY' as const,
          shelfCount,
          looseSkuLines: stockAgg._count,
          looseTotalQty: stockAgg._sum.quantity ?? 0,
          boxCount: boxAgg._count,
          boxTotalQty: boxAgg._sum.quantity ?? 0,
          pendingUnmatched,
        };
      }

      return {
        code: w.code,
        name: w.name,
        region: w.region,
        stockMode: w.stockMode,
        role,
        summary,
      };
    })
  );

  return NextResponse.json({ success: true, data: result });
}
