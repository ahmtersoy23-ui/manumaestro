/**
 * Wisersell aday(lar)ını onaylar: stok teyidi → OutboundOrder (WISERSELL_AUTO) oluştur
 * → DataBridge mark-ready (Kargoya Hazır). Manuel onay route'u + auto-approve job ortak kullanır.
 *
 * Sıra: önce iç OutboundOrder (geri alınabilir), sonra dış mark-ready. mark-ready başarısızsa
 * order DRAFT + wisersellReadyAt null kalır (ready-pending) — retry edilebilir, çift oluşmaz
 * (wisersellOrderId @unique).
 */

import { prisma } from '@/lib/db/prisma';
import { queryDataBridge } from '@/lib/db/prisma';
import { getUsAvailability } from '@/lib/wms/usWarehouseStock';
import { getCgAvailability } from '@/lib/wms/cgStock';
import { getProductsByIwasku } from '@/lib/products/lookup';
import { resolveOrderWarehouse, resolveOrderWarehouseOptions, resolveOrderSplit, needsManualSource, isEtsyChannel, isWayfairChannel, type RoutedWarehouse } from '@/lib/wisersell/orderRouting';
import { markWisersellReady, markWisersellOrderItems } from '@/lib/wisersell/databridgeClient';
import { findChannelDuplicate } from '@/lib/wms/orderDuplicateGuard';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WisersellApprove');

interface CandItem {
  id?: number | null;            // Wisersell orderitem id — üretim durumu (Beklemede) yazmak için
  iwasku: string | null;
  qty: number;
  product_code: string | null;
  product_name: string | null;
  title?: string | null;
  physical?: boolean;
}

function physicalItems(its: CandItem[]): CandItem[] {
  return (its ?? []).filter((i) => i.physical ?? !!(i.iwasku || i.product_code || i.product_name));
}
interface Cand {
  wisersell_order_id: number;
  order_code: string;
  store_id: number | null;
  recipient_name: string | null;
  label_no: string | null;
  region: string | null;
  orderitems: CandItem[];
  ship_address: string | null;
}
interface StoreMap {
  store_id: number;
  marketplace_code: string | null;
  label_prefix: string | null;
}

/** Mobilya manuel kaynak seçimi: depo (warehouse override) veya 'TR' (board'dan gizle). */
export type OrderSource = RoutedWarehouse | 'TR';

export interface ApproveResult {
  wisersellOrderId: number;
  ok: boolean;
  status: 'approved' | 'ready_pending' | 'skipped' | 'error' | 'dismissed_tr';
  warehouse?: string;
  orderId?: string;
  message?: string;
}

/**
 * Onaya hazır (stok-teyitli, henüz outbound'a dönüşmemiş) aday id'lerini döndürür.
 * Auto-approve job + "Tümünü Onayla" için.
 */
export async function getEligibleCandidateIds(region: string): Promise<number[]> {
  const candidates = (await queryDataBridge(
    `SELECT wisersell_order_id::int AS wisersell_order_id, store_id, orderitems FROM wisersell_routing_candidates
     WHERE region = $1 AND gone_at IS NULL`,
    [region],
  )) as Array<{ wisersell_order_id: number; store_id: number | null; orderitems: CandItem[] }>;
  if (!candidates.length) return [];

  const ids = candidates.map((c) => c.wisersell_order_id);
  const approved = await prisma.outboundOrder.findMany({
    where: { wisersellOrderId: { in: ids } },
    select: { wisersellOrderId: true },
  });
  const approvedSet = new Set(approved.map((o) => o.wisersellOrderId));
  const pending = candidates.filter((c) => !approvedSet.has(c.wisersell_order_id));

  // store_id → marketplace_code (Amazon Citi=CUSTOM_01 manuel-kaynak muafiyeti için).
  const storeIds = [...new Set(pending.map((c) => c.store_id).filter((x): x is number => x != null))];
  const storeMaps = storeIds.length
    ? ((await queryDataBridge(`SELECT store_id, marketplace_code FROM wisersell_store_map WHERE store_id = ANY($1::int[])`, [storeIds.map(String)])) as Array<{ store_id: number; marketplace_code: string | null }>)
    : [];
  const codeByStore = new Map(storeMaps.map((s) => [s.store_id, s.marketplace_code]));

  const allIwaskus = [...new Set(pending.flatMap((c) => (c.orderitems ?? []).map((i) => i.iwasku).filter((x): x is string => !!x)))];
  const [avail, cgAvail, productMap] = await Promise.all([
    allIwaskus.length ? getUsAvailability(allIwaskus, { subtractPendingDraft: true }) : Promise.resolve(new Map()),
    allIwaskus.length ? getCgAvailability(allIwaskus) : Promise.resolve(new Map()),
    allIwaskus.length ? getProductsByIwasku(allIwaskus) : Promise.resolve(new Map()),
  ]);

  return pending
    .filter((c) => {
      const phys = physicalItems(c.orderitems);
      if (!phys.length || phys.some((i) => !i.iwasku)) return false; // özel/ödeme veya eşleşmemiş → onaya hazır değil
      const items = phys.map((i) => ({ iwasku: i.iwasku, qty: i.qty, desi: i.iwasku ? productMap.get(i.iwasku)?.desi ?? null : null, category: i.iwasku ? productMap.get(i.iwasku)?.category ?? null : null }));
      const mpCode = c.store_id != null ? codeByStore.get(c.store_id) ?? null : null;
      // Wayfair (dropship): daima US-only (cgAvail yok), hep otomatik — TR/CG'ye gitmez.
      if (isWayfairChannel(mpCode)) return resolveOrderWarehouse(items, avail, undefined) !== null;
      if (needsManualSource(items, mpCode)) return false; // mobilya / Amazon Citi → hep manuel seçim; otomatik onaya girmez
      if (isEtsyChannel(mpCode)) return false;             // Etsy (tüm mağazalar) → manuel onayda kalır
      // Tam-ABD (tek depo VEYA çok-depolu split) → otomatik onaya uygun. TR gereken → değil.
      return resolveOrderSplit(items, avail, cgAvail).feasible;
    })
    .map((c) => c.wisersell_order_id);
}

/**
 * Wayfair/Walmart'ta Wisersell order_code ZATEN kanal sipariş no'sudur (CS…/numeric),
 * Amazon/Shopify/Etsy'de ise order_code iç koddur (ör. 51199) → kanal no'su label_prefix+label_no.
 */
function isOrderCodeChannel(marketplaceCode: string | null): boolean {
  if (!marketplaceCode) return false;
  return /^wayfair/i.test(marketplaceCode) || /^walmart/i.test(marketplaceCode);
}

/**
 * Kanal sipariş no'su:
 * - Wayfair/Walmart: order_code (CS661312852 gibi — paket fişindeki gerçek no).
 * - Diğerleri: label_prefix + label_no (ör. "S_IWAUS" + "22055" = "S_IWAUS22055").
 */
function channelOrderNo(c: Cand, sm: Pick<StoreMap, 'marketplace_code' | 'label_prefix'>): string {
  if (isOrderCodeChannel(sm.marketplace_code)) return (c.order_code ?? '').trim();
  return `${sm.label_prefix ?? ''}${c.label_no ?? ''}`.trim();
}

function buildAddressNote(c: Cand, channelNo: string): string {
  const productNames = physicalItems(c.orderitems).map((i) => i.product_name ?? i.title).filter(Boolean) as string[];
  return [channelNo, c.recipient_name ?? '', c.ship_address ?? '', ...productNames].filter(Boolean).join('\n');
}

export async function approveWisersellCandidates(ids: number[], userId: string, sources?: Map<number, OrderSource>): Promise<ApproveResult[]> {
  if (!ids.length) return [];

  const candidates = (await queryDataBridge(
    `SELECT wisersell_order_id::int AS wisersell_order_id, order_code, store_id, recipient_name, label_no, region, orderitems, ship_address
     FROM wisersell_routing_candidates
     WHERE wisersell_order_id = ANY($1::bigint[]) AND region IS NOT NULL AND gone_at IS NULL`,
    [ids.map(String)],
  )) as Cand[];

  const storeIds = [...new Set(candidates.map((c) => c.store_id).filter((x): x is number => x != null))];
  const storeMaps = storeIds.length
    ? ((await queryDataBridge(
        `SELECT store_id, marketplace_code, label_prefix FROM wisersell_store_map WHERE store_id = ANY($1::int[])`,
        [storeIds.map(String)],
      )) as StoreMap[])
    : [];
  const storeMapById = new Map(storeMaps.map((s) => [s.store_id, s]));

  const allIwaskus = [
    ...new Set(candidates.flatMap((c) => (c.orderitems ?? []).map((i) => i.iwasku).filter((x): x is string => !!x))),
  ];
  const [avail, cgAvail, productMap] = await Promise.all([
    allIwaskus.length ? getUsAvailability(allIwaskus, { subtractPendingDraft: true }) : Promise.resolve(new Map()),
    allIwaskus.length ? getCgAvailability(allIwaskus) : Promise.resolve(new Map()),
    allIwaskus.length ? getProductsByIwasku(allIwaskus) : Promise.resolve(new Map()),
  ]);

  const results: ApproveResult[] = [];
  const foundIds = new Set(candidates.map((c) => c.wisersell_order_id));
  for (const id of ids) {
    if (!foundIds.has(id)) {
      results.push({ wisersellOrderId: id, ok: false, status: 'skipped', message: 'Aday bulunamadı / artık açık değil' });
    }
  }

  for (const c of candidates) {
    const sm = c.store_id != null ? storeMapById.get(c.store_id) : undefined;
    if (!sm?.marketplace_code) {
      results.push({ wisersellOrderId: c.wisersell_order_id, ok: false, status: 'error', message: `store_map eksik (store ${c.store_id})` });
      continue;
    }
    // Fiziksel kalemler (iwasku + adet + Wisersell orderitem id birlikte — split'te id'yi depo
    // grubuna dağıtmak için). id = üretim durumu (Beklemede/Teslim/Yeni) yazmak için.
    const phys = physicalItems(c.orderitems).map((i) => ({
      iwasku: i.iwasku,
      qty: i.qty,
      id: typeof i.id === 'number' ? i.id : null,
      desi: i.iwasku ? productMap.get(i.iwasku)?.desi ?? null : null,
      category: i.iwasku ? productMap.get(i.iwasku)?.category ?? null : null,
    }));
    const items = phys.map(({ iwasku, qty, desi, category }) => ({ iwasku, qty, desi, category }));
    const wsItemIds = phys.map((i) => i.id).filter((x): x is number => typeof x === 'number');

    const override = sources?.get(c.wisersell_order_id);
    // TR (yalnız mobilya / Amazon Citi): outbound YOK, Wisersell'e dokunma — sadece yerel dismiss.
    if (override === 'TR') {
      if (!needsManualSource(items, sm.marketplace_code)) {
        results.push({ wisersellOrderId: c.wisersell_order_id, ok: false, status: 'skipped', message: 'TR yalnız mobilya / Amazon Citi siparişinde seçilebilir' });
        continue;
      }
      await prisma.orderTrDismissed.upsert({
        where: { wisersellOrderId: c.wisersell_order_id },
        create: { wisersellOrderId: c.wisersell_order_id, dismissedById: userId, recipientName: c.recipient_name, orderCode: c.order_code },
        update: {},
      });
      results.push({ wisersellOrderId: c.wisersell_order_id, ok: true, status: 'dismissed_tr', message: 'TR seçildi — board\'dan gizlendi (Wisersell\'e dokunulmadı)' });
      continue;
    }

    // Wayfair (dropship) → CG'ye asla gitmez: routing'de cgAvail'i gizle (yalnız US değerlendirilir).
    const cgForRouting = isWayfairChannel(sm.marketplace_code) ? undefined : cgAvail;

    // Depo grupları: her depo için bir alt-OutboundOrder (split). Override (mobilya/Citi manuel)
    // → daima tek grup. Otomatik routing → tam-ABD ise tek depo VEYA depo-bazlı split.
    type WhGroup = { warehouse: RoutedWarehouse; items: Array<{ iwasku: string; qty: number }>; wsItemIds: number[] };
    let groups: WhGroup[];
    if (override) {
      const options = resolveOrderWarehouseOptions(items, avail, cgForRouting);
      if (!options.includes(override)) {
        results.push({ wisersellOrderId: c.wisersell_order_id, ok: false, status: 'skipped', message: `Seçilen depo (${override}) stoğu tam karşılamıyor` });
        continue;
      }
      groups = [{ warehouse: override, items: items.map((it) => ({ iwasku: it.iwasku!, qty: it.qty })), wsItemIds }];
    } else {
      const plan = resolveOrderSplit(items, avail, cgForRouting);
      if (!plan.feasible) {
        results.push({ wisersellOrderId: c.wisersell_order_id, ok: false, status: 'skipped', message: 'ABD depolarından tam karşılanmıyor (stok/iwasku)' });
        continue;
      }
      if (plan.single) {
        groups = [{ warehouse: plan.single, items: items.map((it) => ({ iwasku: it.iwasku!, qty: it.qty })), wsItemIds }];
      } else {
        // Split: iwasku → depo. Fiziksel kalemleri (id dahil) ait oldukları depo grubuna dağıt.
        const whByIwasku = new Map(plan.assignments.map((a) => [a.iwasku, a.warehouse]));
        const byWh = new Map<RoutedWarehouse, WhGroup>();
        for (const p of phys) {
          const w = whByIwasku.get(p.iwasku!);
          if (!w) continue; // resolveOrderSplit feasible → her iwasku atanmış olmalı (güvenlik)
          let g = byWh.get(w);
          if (!g) { g = { warehouse: w, items: [], wsItemIds: [] }; byWh.set(w, g); }
          g.items.push({ iwasku: p.iwasku!, qty: p.qty });
          if (p.id != null) g.wsItemIds.push(p.id);
        }
        groups = [...byWh.values()];
      }
    }

    // Çift kayıt guard'ı (ters yön): bu kanal no'su (ör. S_IWAUS22055) manuel olarak
    // zaten girilmişse otomatik kayıt açma — operatör elle reconcile etsin.
    const channelNo = channelOrderNo(c, sm);
    if (channelNo) {
      const manualDup = await findChannelDuplicate(channelNo, { excludeWisersellOrderId: c.wisersell_order_id });
      if (manualDup) {
        results.push({ wisersellOrderId: c.wisersell_order_id, ok: false, status: 'skipped', message: `Manuel olarak zaten girilmiş (no: ${manualDup.orderNumber}) — atlandı` });
        continue;
      }
    }

    // OutboundOrder(lar) oluştur — split'te depo başına bir kayıt, TEK transaction (atomik:
    // ya hepsi ya hiç). Kardeşler aynı wisersellOrderId; @@unique([warehouseCode,...]) çakışmaz.
    const isSplit = groups.length > 1;
    let orderIds: string[];
    try {
      orderIds = await prisma.$transaction(async (tx) => {
        const ids: string[] = [];
        for (const g of groups) {
          const order = await tx.outboundOrder.create({
            data: {
              warehouseCode: g.warehouse,
              orderType: 'SINGLE',
              marketplaceCode: sm.marketplace_code!,
              orderNumber: c.order_code,
              channelOrderNumber: channelNo || null,
              addressNote: buildAddressNote(c, channelNo),
              status: 'DRAFT',
              source: 'WISERSELL_AUTO',
              wisersellOrderId: c.wisersell_order_id,
              wisersellOrderItemIds: g.wsItemIds,
              createdById: userId,
            },
          });
          await tx.outboundOrderItem.createMany({
            data: g.items.map((it) => ({ outboundOrderId: order.id, iwasku: it.iwasku, quantity: it.qty })),
          });
          ids.push(order.id);
        }
        return ids;
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // unique violation → zaten onaylı / numara çakışması
      results.push({ wisersellOrderId: c.wisersell_order_id, ok: false, status: 'skipped', message: `Oluşturulamadı (muhtemelen zaten var): ${msg.slice(0, 120)}` });
      continue;
    }

    const whLabel = groups.map((g) => g.warehouse).join('+');
    const orderIdJoined = orderIds.join(',');

    // Üretim kuyruğundan düş: orderitem → Beklemede (5). US-depodan karşılanıyor, üretime gerek yok.
    // Best-effort: Wisersell yazması patlarsa onay akışı bloklanmaz (markWisersellReady gibi).
    // Split'te de tüm fiziksel kalemler tek seferde (sipariş seviyesi).
    if (wsItemIds.length) {
      try {
        await markWisersellOrderItems(wsItemIds, 5);
      } catch (err: unknown) {
        logger.error(`orderitem Beklemede yazılamadı (order ${c.wisersell_order_id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // mark-ready (dış aksiyon, sipariş seviyesi → SADECE 1 kez) — başarısızsa ready-pending bırak.
    // Başarılıysa TÜM kardeş alt-siparişlere wisersellReadyAt yaz.
    try {
      await markWisersellReady([c.wisersell_order_id]);
      await prisma.outboundOrder.updateMany({ where: { wisersellOrderId: c.wisersell_order_id }, data: { wisersellReadyAt: new Date() } });
      results.push({ wisersellOrderId: c.wisersell_order_id, ok: true, status: 'approved', warehouse: whLabel, orderId: orderIdJoined, message: isSplit ? `Ayrı sevk: ${whLabel}` : undefined });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`mark-ready başarısız (order ${c.wisersell_order_id}), ready-pending: ${msg}`);
      results.push({ wisersellOrderId: c.wisersell_order_id, ok: true, status: 'ready_pending', warehouse: whLabel, orderId: orderIdJoined, message: `Outbound oluştu ama Kargoya Hazır yazılamadı (retry): ${msg.slice(0, 120)}` });
    }
  }

  return results;
}
