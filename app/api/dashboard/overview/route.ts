/**
 * GET /api/dashboard/overview
 * Açılış özet dashboard'u — 4 ana grubun başlık metrikleri (UI/IA reorg A1.5).
 * Ucuz aggregate'ler; ağır routing/SP-API yok. Her kart kendi grubuna link verir.
 */

import { prisma } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

interface StokRow { wh: string; skus: number; qty: number }

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Özet getirilemedi' },
  async () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [
      prAgg,
      producedAgg,
      activeShipments,
      completedPr,
      shippedIwaskus,
      draftOrders,
      kapatmaBekliyor,
      amazonCancelled,
      stokRows,
    ] = await Promise.all([
      // ÜRETİM — mevcut ay talebi (talep adedi + adet)
      prisma.productionRequest.aggregate({
        where: { productionMonth: currentMonth, status: { not: 'CANCELLED' } },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      // ÜRETİM — üretilen (MonthSnapshot.produced; dashboard ile aynı kaynak)
      prisma.monthSnapshot.aggregate({ where: { month: currentMonth }, _sum: { produced: true } }),
      // SEVKİYAT — aktif sevkiyat
      prisma.shipment.count({ where: { status: { in: ['PLANNING', 'LOADING', 'IN_TRANSIT'] } } }),
      // SEVKİYAT — bekleyen havuz (COMPLETED PR, henüz sevkiyata eklenmemiş)
      prisma.productionRequest.findMany({ where: { status: 'COMPLETED' }, select: { iwasku: true }, distinct: ['iwasku'] }),
      prisma.shipmentItem.findMany({ select: { iwasku: true }, distinct: ['iwasku'] }),
      // SİPARİŞ — DRAFT siparişler (kanban aşaması için etiket varlığı)
      prisma.outboundOrder.findMany({
        where: { status: 'DRAFT' },
        select: {
          warehouseCode: true,
          amazonCancelledAt: true,
          labels: { where: { type: 'SHIPPING', archivedAt: null, trackingNumber: { not: null } }, select: { id: true }, take: 1 },
        },
      }),
      prisma.outboundOrder.count({ where: { status: 'SHIPPED', source: 'WISERSELL_AUTO', wisersellClosedAt: null } }),
      prisma.outboundOrder.count({ where: { status: 'DRAFT', amazonCancelledAt: { not: null } } }),
      // STOK — depo başına çeşit (distinct SKU) + adet (raf stoğu)
      prisma.$queryRaw<StokRow[]>`
        SELECT "warehouseCode" AS wh, COUNT(DISTINCT iwasku)::int AS skus, COALESCE(SUM(quantity), 0)::int AS qty
        FROM shelf_stock WHERE quantity > 0 GROUP BY "warehouseCode" ORDER BY "warehouseCode"`,
    ]);

    const shippedSet = new Set(shippedIwaskus.map((s) => s.iwasku));
    const pendingPools = completedPr.filter((c) => !shippedSet.has(c.iwasku)).length;

    // Kanban aşamaları (OutboundOrder tarafı; onay/eşleşme aday tarafı board'da)
    const isCg = (w: string) => w === 'CG_SHUKRAN' || w === 'CG_MDN';
    let etiket = 0, cikis = 0, cg = 0;
    for (const o of draftOrders) {
      if (isCg(o.warehouseCode)) cg++;
      else if (o.labels.length) cikis++;
      else etiket++;
    }

    return successResponse({
      uretim: {
        month: currentMonth,
        requests: prAgg._count._all,
        quantity: prAgg._sum.quantity ?? 0,
        produced: producedAgg._sum.produced ?? 0,
      },
      stok: stokRows.map((r) => ({ warehouse: r.wh, skus: r.skus, qty: r.qty })),
      sevkiyat: { active: activeShipments, pendingPools },
      siparis: { etiket, cikis, cg, kapatmaBekliyor, amazonCancelled },
    });
  },
);
