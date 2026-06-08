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
import { requireBoardUser, isBoardManager } from '@/lib/auth/boardAuth';
import { getUsAvailability } from '@/lib/wms/usWarehouseStock';
import { getCgAvailability, type CgAvailability } from '@/lib/wms/cgStock';
import { resolveOrderWarehouse } from '@/lib/wisersell/orderRouting';
import { getProductsByIwasku, usDimensions, type ProductInfo } from '@/lib/products/lookup';

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

/**
 * MANUAL sipariş addressNote'u (eski depolar akışı; pipe'lı serbest metin
 * "Ad | adres | tel | email | kargo tracking") → tablo için alıcı + konum.
 */
function parseManualAddress(note: string | null): { recipient: string | null; location: string | null } {
  if (!note) return { recipient: null, location: null };
  const parts = note.split(/[\n|]/).map((s) => s.trim()).filter(Boolean);
  const recipient = parts[0] ?? null;
  // İlk satır = alıcı; kalan TÜM satırlar adres bloğu (sokak + şehir/eyalet/zip + tel).
  // Eskiden yalnız "STATE ZIP" satırı seçiliyordu → sokak ve telefon düşüyordu (Adres eksik görünüyordu).
  const location = parts.slice(1).join('\n') || null;
  return { recipient, location };
}

export async function GET(request: NextRequest) {
  const auth = await requireBoardUser(request);
  if (auth instanceof NextResponse) return auth;
  const canManage = await isBoardManager(auth.user);

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
  // Stok teyidi: US depo + CG (Shukran/MDN) + ürün bilgisi (desi/kategori → heavy routing) paralel.
  const [avail, cgAvail, productMap] = await Promise.all([
    allIwaskus.length ? getUsAvailability(allIwaskus, { subtractPendingDraft: true }) : Promise.resolve(new Map<string, { NJ: number; SHOWROOM: number }>()),
    allIwaskus.length ? getCgAvailability(allIwaskus) : Promise.resolve(new Map<string, CgAvailability>()),
    allIwaskus.length ? getProductsByIwasku(allIwaskus) : Promise.resolve(new Map<string, ProductInfo>()),
  ]);

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
    // iwasku tamam → routing (heavy/CG → Shukran/MDN; sonra Fairfield/Somerset). Hiçbiri → stok yok (gizle).
    const wh = resolveOrderWarehouse(
      its.map((i) => ({ iwasku: i.iwasku, qty: i.qty, desi: i.iwasku ? productMap.get(i.iwasku)?.desi ?? null : null, category: i.iwasku ? productMap.get(i.iwasku)?.category ?? null : null })),
      avail, cgAvail,
    );
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
    where: { source: { in: ['WISERSELL_AUTO', 'MANUAL'] } },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    include: {
      items: { select: { iwasku: true, quantity: true } },
      labels: { where: { type: 'SHIPPING', archivedAt: null }, select: { id: true, trackingNumber: true, veeqoShipmentId: true, cost: true, costCurrency: true, notes: true }, take: 1 },
    },
  });

  const etiketBekliyor: Array<Record<string, unknown>> = [];
  const cikisBekliyor: Array<Record<string, unknown>> = [];
  const cgBekliyor: Array<Record<string, unknown>> = [];
  const kapatmaBekliyor: Array<Record<string, unknown>> = [];
  const kapandi: Array<Record<string, unknown>> = [];

  const isCgWarehouse = (w?: string | null) => w === 'CG_SHUKRAN' || w === 'CG_MDN';

  for (const o of autoOrders) {
    const shippingLabel = o.labels[0];
    // MANUAL siparişlerde alıcı/adres addressNote'ta serbest metin (pipe'lı) → parse et.
    const manual = o.source === 'MANUAL' ? parseManualAddress(o.addressNote) : null;
    const base = {
      id: o.id,
      wisersellOrderId: o.wisersellOrderId,
      orderNumber: o.orderNumber,
      marketplaceCode: o.marketplaceCode,
      warehouse: o.warehouseCode,
      source: o.source,
      recipientName: manual?.recipient ?? null,
      shipAddress: manual?.location ?? null,
      addressNote: o.addressNote,
      items: o.items,
      // CG'de SHIPPING etiketi yok → tracking manualTracking'ten gelir (tablo/detayda tek alan).
      trackingNumber: shippingLabel?.trackingNumber ?? (isCgWarehouse(o.warehouseCode) ? o.manualTracking : null) ?? null,
      manualTracking: o.manualTracking ?? null,
      labelId: shippingLabel?.id ?? null,
      veeqoShipmentId: shippingLabel?.veeqoShipmentId ?? null, // varsa → "Etiketi İptal Et (iade)" butonu
      labelCost: shippingLabel?.cost != null ? Number(shippingLabel.cost) : null, // etiket bedeli (mutabakat/export)
      labelCostCurrency: shippingLabel?.costCurrency ?? null,
      labelService: shippingLabel?.notes ?? null, // "Veeqo: UPS Ground" — servis adı
      status: o.status,
      createdAt: o.createdAt,
      shippedAt: o.shippedAt,
      wisersellReadyAt: o.wisersellReadyAt,
      wisersellClosedAt: o.wisersellClosedAt,
      cgExportedAt: o.cgExportedAt, // CG MCF Excel alındı mı (badge + tekrar export'a girmesin)
      amazonCancelledAt: o.amazonCancelledAt, // Amazon'da iptal (SP-API) → "İptal (Amazon)" rozeti + Listeden Düş
      // ready-pending Wisersell mark-ready kavramı → yalnız AUTO. MANUAL'da anlamsız.
      readyPending: o.source === 'WISERSELL_AUTO' && !o.wisersellReadyAt,
    };
    if (o.status === 'SHIPPED') {
      // MANUAL siparişler Wisersell'de yok → kapama adımı yok; depodan çıkış = kapandı.
      if (o.source === 'MANUAL' || o.wisersellClosedAt) kapandi.push(base);
      else kapatmaBekliyor.push(base);
    } else if (o.status === 'DRAFT') {
      // CG'de shelf/etiket yok → kendi kovası (MCF + manuel tracking bekler).
      if (isCgWarehouse(o.warehouseCode)) cgBekliyor.push(base);
      else if (shippingLabel && shippingLabel.trackingNumber) cikisBekliyor.push(base);
      else etiketBekliyor.push(base);
    }
    // CANCELLED → board'da gösterme
  }

  // ── 3. Ürün adı + ölçü zenginleştirmesi (tüm koleksiyonlar) ───────────────
  // productMap aday iwasku'larıyla erken kuruldu (routing için); outbound-only iwasku'ları ekle.
  const autoIwaskus = [...new Set(autoOrders.flatMap((o) => o.items.map((i) => i.iwasku).filter((x): x is string => !!x)))];
  const missingIwaskus = autoIwaskus.filter((iw) => !productMap.has(iw));
  if (missingIwaskus.length) {
    const extra = await getProductsByIwasku(missingIwaskus);
    for (const [k, v] of extra) productMap.set(k, v);
  }

  const enrichCand = (i: CandidateItem) => ({
    ...i,
    name: i.product_name ?? (i.iwasku ? productMap.get(i.iwasku)?.name ?? null : null),
    fnsku: i.iwasku ? productMap.get(i.iwasku)?.fnsku ?? null : null,
    dims: i.iwasku ? usDimensions(productMap.get(i.iwasku)) : null,
  });
  const enrichAuto = (i: { iwasku: string | null; quantity: number }) => ({
    iwasku: i.iwasku,
    quantity: i.quantity,
    name: i.iwasku ? productMap.get(i.iwasku)?.name ?? null : null,
    fnsku: i.iwasku ? productMap.get(i.iwasku)?.fnsku ?? null : null,
    dims: i.iwasku ? usDimensions(productMap.get(i.iwasku)) : null,
  });

  for (const row of onayBekliyor) row.items = (row.items as CandidateItem[]).map(enrichCand);
  for (const row of eslesmeGerek) row.items = (row.items as CandidateItem[]).map(enrichCand);
  for (const coll of [etiketBekliyor, cikisBekliyor, cgBekliyor, kapatmaBekliyor, kapandi]) {
    for (const row of coll) row.items = (row.items as Array<{ iwasku: string | null; quantity: number }>).map(enrichAuto);
  }

  // ── 4. Pazar yeri dostça adı ──────────────────────────────────────────────
  // marketplaceCode → bizim Marketplace tablosundaki ad. Wisersell store kodları
  // (Ama_US, Etsy_BMU, S_UPPUS vb.) tabloda yoksa olduğu gibi kalır → Wisersell ile
  // uyumlu; bizim CUSTOM_xx kodlar friendly ada çevrilir (Shopify/Etsy/Walmart…).
  const allCollections = [onayBekliyor, eslesmeGerek, etiketBekliyor, cikisBekliyor, cgBekliyor, kapatmaBekliyor, kapandi];
  const mpCodes = [...new Set(allCollections.flat().map((r) => r.marketplaceCode).filter(Boolean) as string[])];
  const mpNameByCode = new Map<string, string>();
  if (mpCodes.length) {
    const mpRows = await prisma.marketplace.findMany({ where: { code: { in: mpCodes } }, select: { code: true, name: true } });
    for (const m of mpRows) mpNameByCode.set(m.code, m.name);
  }
  for (const coll of allCollections) {
    for (const row of coll) row.marketplaceLabel = mpNameByCode.get(row.marketplaceCode as string) ?? null;
  }

  const warehouseCounts = (rows: Array<Record<string, unknown>>) => ({
    SHOWROOM: rows.filter((r) => r.warehouse === 'SHOWROOM').length,
    NJ: rows.filter((r) => r.warehouse === 'NJ').length,
    CG_SHUKRAN: rows.filter((r) => r.warehouse === 'CG_SHUKRAN').length,
    CG_MDN: rows.filter((r) => r.warehouse === 'CG_MDN').length,
  });

  return NextResponse.json({
    success: true,
    region,
    canManage, // Wisersell otomasyon (onayla/kapat/auto-run) yetkisi — UI buton gating
    counts: {
      onayBekliyor: onayBekliyor.length,
      eslesmeGerek: eslesmeGerek.length,
      etiketBekliyor: etiketBekliyor.length,
      cikisBekliyor: cikisBekliyor.length,
      cgBekliyor: cgBekliyor.length,
      kapatmaBekliyor: kapatmaBekliyor.length,
      kapandi: kapandi.length,
      stokYok,
    },
    warehouseStats: {
      onayBekliyor: warehouseCounts(onayBekliyor),
    },
    data: { onayBekliyor, eslesmeGerek, etiketBekliyor, cikisBekliyor, cgBekliyor, kapatmaBekliyor, kapandi },
  });
}
