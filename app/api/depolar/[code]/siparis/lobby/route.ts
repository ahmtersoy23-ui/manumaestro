/**
 * GET /api/depolar/[code]/siparis/lobby
 * Sipariş çıkış lobi sayfası için aggregate veriler:
 *   - totals: depo geneli kargoBekleyen + cikisBekleyen
 *   - byMarketplace: her marketplace için kargoBekleyen / cikisBekleyen / shipped
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getMarketplaceAccess } from '@/lib/auth/marketplaceAccess';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const SHELF_PRIMARY = new Set(['NJ', 'SHOWROOM']);

export const GET = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Sipariş lobisi alınamadı' },
  async ({ request, params }) => {
    const { code } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }
    if (!SHELF_PRIMARY.has(upperCode)) {
      return NextResponse.json(
        { success: false, error: 'Sipariş çıkışı yalnız NJ ve SHOWROOM depolarında' },
        { status: 400 }
      );
    }

    const auth = await requireShelfAction(request, upperCode, 'view');
    if (auth instanceof NextResponse) return auth;

    const mpAccess = await getMarketplaceAccess(auth.user.id, auth.user.role);

    // Yalnız SINGLE — FBA_PICKUP (koli bazlı çıkış) ayrı Pickup sekmesinde.
    const orders = await prisma.outboundOrder.findMany({
      where: { warehouseCode: upperCode, orderType: 'SINGLE' },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        marketplaceCode: true,
        status: true,
        labels: {
          where: { type: 'SHIPPING', archivedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    });

    const totals = { kargoBekleyen: 0, cikisBekleyen: 0 };
    const mpMap = new Map<
      string,
      { kargoBekleyen: number; cikisBekleyen: number; shipped: number }
    >();

    for (const o of orders) {
      const stats = mpMap.get(o.marketplaceCode) ?? {
        kargoBekleyen: 0,
        cikisBekleyen: 0,
        shipped: 0,
      };
      if (o.status === 'DRAFT') {
        if (o.labels.length > 0) {
          stats.cikisBekleyen += 1;
          totals.cikisBekleyen += 1;
        } else {
          stats.kargoBekleyen += 1;
          totals.kargoBekleyen += 1;
        }
      } else if (o.status === 'SHIPPED') {
        stats.shipped += 1;
      }
      mpMap.set(o.marketplaceCode, stats);
    }

    const byMarketplace = Array.from(mpMap.entries()).map(([marketplaceCode, stats]) => ({
      marketplaceCode,
      ...stats,
    }));

    return successResponse({
      role: auth.shelfRole,
      totals,
      byMarketplace,
      access: {
        allMarketplaces: mpAccess.allAccess,
        viewable: Array.from(mpAccess.viewableCodes),
        editable: Array.from(mpAccess.editableCodes),
      },
    });
  }
);
