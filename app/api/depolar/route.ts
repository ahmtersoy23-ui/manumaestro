/**
 * GET /api/depolar
 * Kullanıcının erişebileceği depoları + her birinin temel özet sayılarını döner.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfView } from '@/lib/auth/requireShelfRole';
import { getShelfRole } from '@/lib/auth/shelfPermission';

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

  // Her depo için role + özet
  const result = await Promise.all(
    warehouses.map(async (w) => {
      const role = await getShelfRole(auth.user.id, auth.user.role, w.code);
      const [shelfCount, stockAgg, boxAgg, pendingUnmatched] = await Promise.all([
        prisma.shelf.count({ where: { warehouseCode: w.code, isActive: true } }),
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
        prisma.unmatchedSeedRow.count({
          where: { warehouseCode: w.code, status: 'PENDING' },
        }),
      ]);

      return {
        code: w.code,
        name: w.name,
        region: w.region,
        stockMode: w.stockMode,
        role,
        summary: {
          shelfCount,
          looseSkuLines: stockAgg._count,
          looseTotalQty: stockAgg._sum.quantity ?? 0,
          boxCount: boxAgg._count,
          boxTotalQty: boxAgg._sum.quantity ?? 0,
          pendingUnmatched,
        },
      };
    })
  );

  return NextResponse.json({ success: true, data: result });
}
