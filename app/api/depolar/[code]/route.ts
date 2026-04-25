/**
 * GET /api/depolar/[code]
 * Tek bir deponun ayrıntılı özeti — Dashboard sekmesi için.
 * Ankara (TOTALS_PRIMARY): WarehouseProduct toplamı.
 * NJ + Showroom (SHELF_PRIMARY): ShelfStock + ShelfBox.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getAnkaraTotals } from '@/lib/warehouse/ankaraTotals';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'view');
  if (auth instanceof NextResponse) return auth;

  const warehouse = await prisma.warehouse.findUnique({ where: { code: upperCode } });
  if (!warehouse) {
    return NextResponse.json({ success: false, error: 'Depo bulunamadı' }, { status: 404 });
  }

  const [shelfCount, pendingUnmatched, recentMovements] = await Promise.all([
    prisma.shelf.count({ where: { warehouseCode: upperCode, isActive: true } }),
    prisma.unmatchedSeedRow.count({
      where: { warehouseCode: upperCode, status: 'PENDING' },
    }),
    prisma.shelfMovement.findMany({
      where: { warehouseCode: upperCode },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, type: true, iwasku: true, quantity: true,
        fromShelfId: true, toShelfId: true, refType: true,
        userId: true, createdAt: true, notes: true,
      },
    }),
  ]);

  let summary;
  if (warehouse.stockMode === 'TOTALS_PRIMARY') {
    const totals = await getAnkaraTotals();
    summary = {
      mode: 'TOTALS_PRIMARY' as const,
      shelfCount,
      totalQty: totals.totalQty,
      productCount: totals.productCount,
      pendingUnmatched,
    };
  } else {
    const [stockAgg, boxStatusGroup] = await Promise.all([
      prisma.shelfStock.aggregate({
        where: { warehouseCode: upperCode },
        _sum: { quantity: true },
        _count: true,
      }),
      prisma.shelfBox.groupBy({
        by: ['status'],
        where: { warehouseCode: upperCode },
        _count: true,
        _sum: { quantity: true },
      }),
    ]);
    summary = {
      mode: 'SHELF_PRIMARY' as const,
      shelfCount,
      looseSkuLines: stockAgg._count,
      looseTotalQty: stockAgg._sum.quantity ?? 0,
      boxesByStatus: boxStatusGroup.map((g) => ({
        status: g.status,
        count: g._count,
        quantity: g._sum.quantity ?? 0,
      })),
      pendingUnmatched,
    };
  }

  return NextResponse.json({
    success: true,
    data: {
      warehouse: {
        code: warehouse.code,
        name: warehouse.name,
        region: warehouse.region,
        stockMode: warehouse.stockMode,
      },
      role: auth.shelfRole,
      summary,
      recentMovements,
    },
  });
}
