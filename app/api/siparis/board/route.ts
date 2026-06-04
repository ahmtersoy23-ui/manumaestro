/**
 * GET /api/siparis/board?region=US
 *
 * Birleşik Sipariş ekranının veri kaynağı (süper-admin). İki kaynağı birleştirir:
 *  - Wisersell adayları (DataBridge wisersell_routing_candidates) → stok teyidi (Fairfield→Somerset,
 *    TAM karşılama) → "Onay Bekliyor" (henüz OutboundOrder yoksa).
 *  - WISERSELL_AUTO OutboundOrder'lar → Etiket/Çıkış/Kapatma/Kapandı.
 *
 * region: ülke-genişletilebilir (şimdi 'US'). Stok/routing US depolarına (Fairfield/Somerset)
 * bağlı; başka region eklenince kendi availability mantığı eklenir.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { queryDataBridge } from '@/lib/db/prisma';
import { requireSuperAdmin } from '@/lib/auth/verify';
import { getUsAvailability } from '@/lib/wms/usWarehouseStock';
import { resolveOrderWarehouse } from '@/lib/wisersell/orderRouting';
import { getProductsByIwasku } from '@/lib/products/lookup';

interface CandidateItem {
  iwasku: string | null;
  qty: number;
  product_code: string | null;
  marketplace_sku: string | null;
  product_name: string | null;
  resolved_by: string | null;
}

interface CandidateRow {
  wisersell_order_id: number;
  order_code: string;
  store_id: number | null;
  recipient_name: string | null;
  label_no: string | null;
  region: string | null;
  orderitems: CandidateItem[];
  created_at_ws: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const region = new URL(request.url).searchParams.get('region') || 'US';

  // ── 1. Adaylar (DataBridge) ───────────────────────────────────────────────
  const candidates = await queryDataBridge(
    `SELECT wisersell_order_id::int AS wisersell_order_id, order_code, store_id, recipient_name, label_no, region,
            orderitems, created_at_ws
     FROM wisersell_routing_candidates
     WHERE region = $1 AND gone_at IS NULL
     ORDER BY created_at_ws DESC NULLS LAST
     LIMIT 1000`,
    [region],
  ) as CandidateRow[];

  // Zaten outbound'a dönüşmüş (onaylanmış) wisersellOrderId'leri çıkar
  const candidateIds = candidates.map((c) => c.wisersell_order_id);
  const existingAuto = candidateIds.length
    ? await prisma.outboundOrder.findMany({
        where: { wisersellOrderId: { in: candidateIds } },
        select: { wisersellOrderId: true },
      })
    : [];
  const approvedSet = new Set(existingAuto.map((o) => o.wisersellOrderId));

  const pendingCandidates = candidates.filter((c) => !approvedSet.has(c.wisersell_order_id));

  // Stok teyidi: tüm iwasku'lar için availability
  const allIwaskus = [
    ...new Set(
      pendingCandidates.flatMap((c) => (c.orderitems ?? []).map((i) => i.iwasku).filter((x): x is string => !!x)),
    ),
  ];
  const avail = allIwaskus.length ? await getUsAvailability(allIwaskus, { subtractPendingDraft: true }) : new Map();

  const onayBekliyor: Array<Record<string, unknown>> = [];
  let bekleyenStokYok = 0;
  for (const c of pendingCandidates) {
    const items = (c.orderitems ?? []).map((i) => ({ iwasku: i.iwasku, qty: i.qty }));
    const wh = resolveOrderWarehouse(items, avail);
    if (!wh) {
      bekleyenStokYok++;
      continue; // TAM karşılanmıyor / iwasku yok → pas geç (gösterme)
    }
    onayBekliyor.push({
      wisersellOrderId: c.wisersell_order_id,
      orderCode: c.order_code,
      recipientName: c.recipient_name,
      labelNo: c.label_no,
      warehouse: wh,
      items: c.orderitems,
      createdAt: c.created_at_ws,
    });
  }

  // ── 2. WISERSELL_AUTO outbound'lar ────────────────────────────────────────
  const autoOrders = await prisma.outboundOrder.findMany({
    where: { source: 'WISERSELL_AUTO' },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    include: {
      items: { select: { iwasku: true, quantity: true } },
      labels: { where: { type: 'SHIPPING', archivedAt: null }, select: { id: true, trackingNumber: true }, take: 1 },
    },
  });

  const etiketBekliyor: Array<Record<string, unknown>> = [];
  const cikisBekliyor: Array<Record<string, unknown>> = [];
  const kapatmaBekliyor: Array<Record<string, unknown>> = [];
  const kapandi: Array<Record<string, unknown>> = [];

  for (const o of autoOrders) {
    const shippingLabel = o.labels[0];
    const base = {
      id: o.id,
      wisersellOrderId: o.wisersellOrderId,
      orderNumber: o.orderNumber,
      marketplaceCode: o.marketplaceCode,
      warehouse: o.warehouseCode,
      addressNote: o.addressNote,
      items: o.items,
      trackingNumber: shippingLabel?.trackingNumber ?? null,
      status: o.status,
      createdAt: o.createdAt,
      shippedAt: o.shippedAt,
      wisersellReadyAt: o.wisersellReadyAt,
      wisersellClosedAt: o.wisersellClosedAt,
      readyPending: !o.wisersellReadyAt, // mark-ready başarısız/eksik → retry gerek
    };
    if (o.status === 'SHIPPED') {
      if (o.wisersellClosedAt) kapandi.push(base);
      else kapatmaBekliyor.push(base);
    } else if (o.status === 'DRAFT') {
      if (shippingLabel && shippingLabel.trackingNumber) cikisBekliyor.push(base);
      else etiketBekliyor.push(base);
    }
    // CANCELLED → board'da gösterme
  }

  // Ürün adları (Onay Bekliyor kalemleri için)
  const productMap = allIwaskus.length ? await getProductsByIwasku(allIwaskus) : new Map();
  for (const row of onayBekliyor) {
    const items = row.items as CandidateItem[];
    row.items = items.map((i) => ({
      ...i,
      name: i.product_name ?? (i.iwasku ? productMap.get(i.iwasku)?.name ?? null : null),
    }));
  }

  const warehouseCounts = (rows: Array<Record<string, unknown>>) => ({
    SHOWROOM: rows.filter((r) => r.warehouse === 'SHOWROOM').length,
    NJ: rows.filter((r) => r.warehouse === 'NJ').length,
  });

  return NextResponse.json({
    success: true,
    region,
    counts: {
      onayBekliyor: onayBekliyor.length,
      etiketBekliyor: etiketBekliyor.length,
      cikisBekliyor: cikisBekliyor.length,
      kapatmaBekliyor: kapatmaBekliyor.length,
      kapandi: kapandi.length,
      bekleyenStokYok,
    },
    warehouseStats: {
      onayBekliyor: warehouseCounts(onayBekliyor),
    },
    data: { onayBekliyor, etiketBekliyor, cikisBekliyor, kapatmaBekliyor, kapandi },
  });
}
