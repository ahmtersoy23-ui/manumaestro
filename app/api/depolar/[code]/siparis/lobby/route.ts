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
import { getUsAvailability } from '@/lib/wms/usWarehouseStock';
import { getProductsByIwasku } from '@/lib/products/lookup';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

// Fairfield'dan son N günde çıkışı yapılan kalemler tarandı; bu pencereyi aşan
// eski sevkiyatlar transfer önerisinde gösterilmez.
const TRANSFER_LOOKBACK_DAYS = 90;

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

    const orders = await prisma.outboundOrder.findMany({
      where: { warehouseCode: upperCode },
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

    // Transfer önerisi (yalnız Fairfield/SHOWROOM lobisinde):
    // Son TRANSFER_LOOKBACK_DAYS gün içinde Fairfield'dan çıkışı yapılmış,
    // şu an Fairfield'da stoğu sıfıra düşmüş ama Somerset'te (NJ) hâlâ olan
    // ürünler → Somerset'ten Fairfield'a transfer önerilir.
    let transferSuggestions: {
      iwasku: string;
      name: string | null;
      somerset: number;
      lastShippedAt: string;
    }[] = [];

    if (upperCode === 'SHOWROOM') {
      const cutoff = new Date(Date.now() - TRANSFER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const shippedOrders = await prisma.outboundOrder.findMany({
        where: { warehouseCode: 'SHOWROOM', status: 'SHIPPED', shippedAt: { gte: cutoff } },
        select: { shippedAt: true, items: { select: { iwasku: true } } },
      });

      const lastShipByIwasku = new Map<string, Date>();
      for (const o of shippedOrders) {
        if (!o.shippedAt) continue;
        for (const it of o.items) {
          const prev = lastShipByIwasku.get(it.iwasku);
          if (!prev || o.shippedAt > prev) lastShipByIwasku.set(it.iwasku, o.shippedAt);
        }
      }

      const shippedIwaskus = [...lastShipByIwasku.keys()];
      if (shippedIwaskus.length > 0) {
        const avail = await getUsAvailability(shippedIwaskus);
        const lowIwaskus = shippedIwaskus.filter((iw) => {
          const a = avail.get(iw) ?? { NJ: 0, SHOWROOM: 0 };
          return a.SHOWROOM <= 0 && a.NJ > 0; // Fairfield bitti, Somerset'te var
        });
        if (lowIwaskus.length > 0) {
          const productMap = await getProductsByIwasku(lowIwaskus);
          transferSuggestions = lowIwaskus
            .map((iw) => ({
              iwasku: iw,
              name: productMap.get(iw)?.name ?? null,
              somerset: avail.get(iw)?.NJ ?? 0,
              lastShippedAt: lastShipByIwasku.get(iw)!.toISOString(),
            }))
            .sort((a, b) => b.lastShippedAt.localeCompare(a.lastShippedAt));
        }
      }
    }

    return successResponse({
      role: auth.shelfRole,
      totals,
      byMarketplace,
      transferSuggestions,
      access: {
        allMarketplaces: mpAccess.allAccess,
        viewable: Array.from(mpAccess.viewableCodes),
        editable: Array.from(mpAccess.editableCodes),
      },
    });
  }
);
