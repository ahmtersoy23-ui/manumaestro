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
import { getProductsByIwasku, usDimensions } from '@/lib/products/lookup';

interface CandidateItem {
  iwasku: string | null;
  qty: number;
  product_code: string | null;
  marketplace_sku: string | null;
  product_name: string | null;
  title?: string | null;
  physical?: boolean;
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
  ship_address: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const region = new URL(request.url).searchParams.get('region') || 'US';

  // ── 1. Adaylar (DataBridge) ───────────────────────────────────────────────
  const candidates = await queryDataBridge(
    `SELECT wisersell_order_id::int AS wisersell_order_id, order_code, store_id, recipient_name, label_no, region,
            orderitems, created_at_ws, ship_address
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

  // store_id → marketplace etiketi (pazar yeri kolonu)
  const storeMapRows = await queryDataBridge(
    `SELECT store_id, marketplace_code, COALESCE(NULLIF(label_prefix,''), marketplace_code) AS label FROM wisersell_store_map WHERE region = $1`,
    [region],
  ) as Array<{ store_id: number; marketplace_code: string | null; label: string | null }>;
  const marketplaceByStore = new Map(storeMapRows.map((s) => [Number(s.store_id), s.label || s.marketplace_code || `store ${s.store_id}`]));

  // Stok teyidi: tüm iwasku'lar için availability
  const allIwaskus = [
    ...new Set(
      pendingCandidates.flatMap((c) => (c.orderitems ?? []).map((i) => i.iwasku).filter((x): x is string => !!x)),
    ),
  ];
  const avail = allIwaskus.length ? await getUsAvailability(allIwaskus, { subtractPendingDraft: true }) : new Map();

  const onayBekliyor: Array<Record<string, unknown>> = [];
  const eslesmeGerek: Array<Record<string, unknown>> = [];
  let stokYok = 0;
  for (const c of pendingCandidates) {
    const all = c.orderitems ?? [];
    // Fiziksel ürün kalemleri (özel/ödeme-linki satırları hariç). physical alanı yoksa
    // (eski kayıt) herhangi bir kimlik varsa fiziksel say.
    const its = all.filter((i) => i.physical ?? !!(i.iwasku || i.product_code || i.marketplace_sku || i.product_name));
    if (its.length === 0) continue; // sadece özel/ödeme → karşılanamaz, board'da gösterme
    const mp = marketplaceByStore.get(Number(c.store_id)) ?? (c.store_id != null ? `store ${c.store_id}` : null);
    // iwasku eşleşmemiş fiziksel kalem → "Eşleşme Gerek" (mapping talebi GÖRÜNÜR)
    if (its.some((i) => !i.iwasku)) {
      eslesmeGerek.push({
        wisersellOrderId: c.wisersell_order_id,
        orderCode: c.order_code,
        recipientName: c.recipient_name,
        marketplaceCode: mp,
        warehouse: null,
        shipAddress: c.ship_address,
        items: its,
        unresolved: its.filter((i) => !i.iwasku).map((i) => ({ product_code: i.product_code, marketplace_sku: i.marketplace_sku, title: i.title ?? i.product_name })),
        createdAt: c.created_at_ws,
      });
      continue;
    }
    // iwasku tamam ama tek depodan tam karşılanmıyor → stok yok (gizle, sadece say)
    const wh = resolveOrderWarehouse(its.map((i) => ({ iwasku: i.iwasku, qty: i.qty })), avail);
    if (!wh) { stokYok++; continue; }
    onayBekliyor.push({
      wisersellOrderId: c.wisersell_order_id,
      orderCode: c.order_code,
      recipientName: c.recipient_name,
      labelNo: c.label_no,
      warehouse: wh,
      marketplaceCode: mp,
      shipAddress: c.ship_address,
      items: its,
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
      labelId: shippingLabel?.id ?? null,
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

  // ── 3. Ürün adı + ölçü zenginleştirmesi (tüm koleksiyonlar) ───────────────
  // Aday + outbound tüm iwasku'lar tek lookup'ta — her durumda standart name +
  // katalog ölçüsü (inç/lb) görünür (etiket/çıkış vs. eskiden sadece iwasku idi).
  const autoIwaskus = autoOrders.flatMap((o) => o.items.map((i) => i.iwasku).filter((x): x is string => !!x));
  const lookupIwaskus = [...new Set([...allIwaskus, ...autoIwaskus])];
  const productMap = lookupIwaskus.length ? await getProductsByIwasku(lookupIwaskus) : new Map();

  const enrichCand = (i: CandidateItem) => ({
    ...i,
    name: i.product_name ?? (i.iwasku ? productMap.get(i.iwasku)?.name ?? null : null),
    dims: i.iwasku ? usDimensions(productMap.get(i.iwasku)) : null,
  });
  const enrichAuto = (i: { iwasku: string | null; quantity: number }) => ({
    iwasku: i.iwasku,
    quantity: i.quantity,
    name: i.iwasku ? productMap.get(i.iwasku)?.name ?? null : null,
    dims: i.iwasku ? usDimensions(productMap.get(i.iwasku)) : null,
  });

  for (const row of onayBekliyor) row.items = (row.items as CandidateItem[]).map(enrichCand);
  for (const row of eslesmeGerek) row.items = (row.items as CandidateItem[]).map(enrichCand);
  for (const coll of [etiketBekliyor, cikisBekliyor, kapatmaBekliyor, kapandi]) {
    for (const row of coll) row.items = (row.items as Array<{ iwasku: string | null; quantity: number }>).map(enrichAuto);
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
      eslesmeGerek: eslesmeGerek.length,
      etiketBekliyor: etiketBekliyor.length,
      cikisBekliyor: cikisBekliyor.length,
      kapatmaBekliyor: kapatmaBekliyor.length,
      kapandi: kapandi.length,
      stokYok,
    },
    warehouseStats: {
      onayBekliyor: warehouseCounts(onayBekliyor),
    },
    data: { onayBekliyor, eslesmeGerek, etiketBekliyor, cikisBekliyor, kapatmaBekliyor, kapandi },
  });
}
