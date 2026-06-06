/**
 * GET /api/dashboard/overview
 * Açılış özet dashboard'u — 4 ana grubun başlık metrikleri (UI/IA reorg A1.5).
 * Ucuz aggregate'ler; ağır routing/SP-API yok. Her kart kendi grubuna link verir.
 */

import { prisma } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';
import { getAnkaraTotals } from '@/lib/warehouse/ankaraTotals';

interface StokRow { wh: string; skus: number; qty: number }

// Üretim grubu sınıflandırması (dashboard ile aynı)
const HAZIR_ALIM = ['Alsat', 'Tekstil'];
const MOBILYA = ['Mobilya'];
function productionGroupOf(cat: string | null): 'fabrika' | 'mobilya' | 'hazirAlim' {
  if (cat && HAZIR_ALIM.includes(cat)) return 'hazirAlim';
  if (cat && MOBILYA.includes(cat)) return 'mobilya';
  return 'fabrika';
}

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Özet getirilemedi' },
  async () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [
      prAgg,
      producedAgg,
      catGroups,
      shipmentGroups,
      completedPr,
      shippedIwaskus,
      draftOrders,
      kapatmaBekliyor,
      amazonCancelled,
      stokRows,
      ankaraTotals,
    ] = await Promise.all([
      // ÜRETİM — mevcut ay talebi (talep adedi + adet)
      prisma.productionRequest.aggregate({
        where: { productionMonth: currentMonth, status: { not: 'CANCELLED' } },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      // ÜRETİM — üretilen (MonthSnapshot.produced; dashboard ile aynı kaynak)
      prisma.monthSnapshot.aggregate({ where: { month: currentMonth }, _sum: { produced: true } }),
      // ÜRETİM — kategori (grup) bazında talep
      prisma.productionRequest.groupBy({
        by: ['productCategory'],
        where: { productionMonth: currentMonth, status: { not: 'CANCELLED' } },
        _sum: { quantity: true },
      }),
      // SEVKİYAT — duruma göre kırılım
      prisma.shipment.groupBy({ by: ['status'], _count: { _all: true } }),
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
      // STOK — depo başına çeşit (distinct SKU) + adet — raf stoğu (loose) + SEALED koliler
      prisma.$queryRaw<StokRow[]>`
        SELECT wh, COUNT(DISTINCT iwasku)::int AS skus, COALESCE(SUM(qty), 0)::int AS qty FROM (
          SELECT "warehouseCode" AS wh, iwasku, quantity AS qty FROM shelf_stock WHERE quantity > 0
          UNION ALL
          SELECT "warehouseCode" AS wh, iwasku, quantity AS qty FROM shelf_boxes WHERE quantity > 0 AND status = 'SEALED'
        ) t GROUP BY wh ORDER BY wh`,
      // STOK — Ankara (TOTALS_PRIMARY: WarehouseProduct, Depolar dashboard ile aynı kaynak)
      getAnkaraTotals(),
    ]);

    const shippedSet = new Set(shippedIwaskus.map((s) => s.iwasku));
    const pendingPools = completedPr.filter((c) => !shippedSet.has(c.iwasku)).length;

    const shipBy = Object.fromEntries(shipmentGroups.map((g) => [g.status, g._count._all]));

    // Üretim grup (kategori) kırılımı
    const groupSum: Record<string, number> = { fabrika: 0, mobilya: 0, hazirAlim: 0 };
    for (const g of catGroups) groupSum[productionGroupOf(g.productCategory)] += g._sum.quantity ?? 0;
    const uretimGroups = [
      { key: 'fabrika', label: 'IWA Fabrika', quantity: groupSum.fabrika },
      { key: 'mobilya', label: 'CİTİ Mobilya', quantity: groupSum.mobilya },
      { key: 'hazirAlim', label: 'Hazır Alım', quantity: groupSum.hazirAlim },
    ].filter((g) => g.quantity > 0);

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
        groups: uretimGroups,
      },
      stok: [
        { warehouse: 'ANKARA', skus: ankaraTotals.productCount, qty: ankaraTotals.totalQty },
        ...stokRows.filter((r) => r.wh !== 'ANKARA').map((r) => ({ warehouse: r.wh, skus: r.skus, qty: r.qty })),
      ],
      sevkiyat: {
        planning: shipBy.PLANNING ?? 0,
        loading: shipBy.LOADING ?? 0,
        inTransit: shipBy.IN_TRANSIT ?? 0,
        pendingPools,
      },
      siparis: { etiket, cikis, cg, kapatmaBekliyor, amazonCancelled },
    });
  },
);
