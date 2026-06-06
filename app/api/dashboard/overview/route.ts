/**
 * GET /api/dashboard/overview
 * Açılış özet dashboard'u — 4 ana grubun başlık metrikleri (UI/IA reorg A1.5).
 * Ucuz aggregate'ler; ağır routing/SP-API yok. Her kart kendi grubuna link verir.
 */

import { prisma } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Özet getirilemedi' },
  async () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [
      prAgg,
      activeShipments,
      completedPr,
      shippedIwaskus,
      draft,
      amazonCancelled,
      kapatmaBekliyor,
      stokGroups,
    ] = await Promise.all([
      // ÜRETİM — mevcut ay talebi
      prisma.productionRequest.aggregate({
        where: { productionMonth: currentMonth, status: { not: 'CANCELLED' } },
        _count: { _all: true },
        _sum: { quantity: true, producedQuantity: true },
      }),
      // SEVKİYAT — aktif sevkiyat
      prisma.shipment.count({ where: { status: { in: ['PLANNING', 'LOADING', 'IN_TRANSIT'] } } }),
      // SEVKİYAT — bekleyen havuz (COMPLETED PR, henüz sevkiyata eklenmemiş)
      prisma.productionRequest.findMany({ where: { status: 'COMPLETED' }, select: { iwasku: true }, distinct: ['iwasku'] }),
      prisma.shipmentItem.findMany({ select: { iwasku: true }, distinct: ['iwasku'] }),
      // SİPARİŞ
      prisma.outboundOrder.count({ where: { status: 'DRAFT' } }),
      prisma.outboundOrder.count({ where: { status: 'DRAFT', amazonCancelledAt: { not: null } } }),
      prisma.outboundOrder.count({ where: { status: 'SHIPPED', source: 'WISERSELL_AUTO', wisersellClosedAt: null } }),
      // STOK — depo başına kalem (raf stoğu satırı) + adet
      prisma.shelfStock.groupBy({
        by: ['warehouseCode'],
        where: { quantity: { gt: 0 } },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
    ]);

    const shippedSet = new Set(shippedIwaskus.map((s) => s.iwasku));
    const pendingPools = completedPr.filter((c) => !shippedSet.has(c.iwasku)).length;

    return successResponse({
      uretim: {
        month: currentMonth,
        requests: prAgg._count._all,
        quantity: prAgg._sum.quantity ?? 0,
        produced: prAgg._sum.producedQuantity ?? 0,
      },
      stok: stokGroups
        .map((g) => ({ warehouse: g.warehouseCode, lines: g._count._all, qty: g._sum.quantity ?? 0 }))
        .sort((a, b) => a.warehouse.localeCompare(b.warehouse)),
      sevkiyat: { active: activeShipments, pendingPools },
      siparis: { draft, amazonCancelled, kapatmaBekliyor },
    });
  },
);
