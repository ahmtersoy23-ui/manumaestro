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
import { resolveOrderWarehouse } from '@/lib/wisersell/orderRouting';
import { markWisersellReady } from '@/lib/wisersell/databridgeClient';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WisersellApprove');

interface CandItem {
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

export interface ApproveResult {
  wisersellOrderId: number;
  ok: boolean;
  status: 'approved' | 'ready_pending' | 'skipped' | 'error';
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
    `SELECT wisersell_order_id::int AS wisersell_order_id, orderitems FROM wisersell_routing_candidates
     WHERE region = $1 AND gone_at IS NULL`,
    [region],
  )) as Array<{ wisersell_order_id: number; orderitems: CandItem[] }>;
  if (!candidates.length) return [];

  const ids = candidates.map((c) => c.wisersell_order_id);
  const approved = await prisma.outboundOrder.findMany({
    where: { wisersellOrderId: { in: ids } },
    select: { wisersellOrderId: true },
  });
  const approvedSet = new Set(approved.map((o) => o.wisersellOrderId));
  const pending = candidates.filter((c) => !approvedSet.has(c.wisersell_order_id));

  const allIwaskus = [...new Set(pending.flatMap((c) => (c.orderitems ?? []).map((i) => i.iwasku).filter((x): x is string => !!x)))];
  const avail = allIwaskus.length ? await getUsAvailability(allIwaskus, { subtractPendingDraft: true }) : new Map();

  return pending
    .filter((c) => {
      const phys = physicalItems(c.orderitems);
      if (!phys.length || phys.some((i) => !i.iwasku)) return false; // özel/ödeme veya eşleşmemiş → onaya hazır değil
      return resolveOrderWarehouse(phys.map((i) => ({ iwasku: i.iwasku, qty: i.qty })), avail) !== null;
    })
    .map((c) => c.wisersell_order_id);
}

function buildAddressNote(c: Cand, labelPrefix: string | null): string {
  const labelBase = `${labelPrefix ?? ''}${c.label_no ?? ''}`.trim();
  const productNames = physicalItems(c.orderitems).map((i) => i.product_name ?? i.title).filter(Boolean) as string[];
  return [labelBase, c.recipient_name ?? '', c.ship_address ?? '', ...productNames].filter(Boolean).join('\n');
}

export async function approveWisersellCandidates(ids: number[], userId: string): Promise<ApproveResult[]> {
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
  const avail = allIwaskus.length ? await getUsAvailability(allIwaskus, { subtractPendingDraft: true }) : new Map();

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
    const items = physicalItems(c.orderitems).map((i) => ({ iwasku: i.iwasku, qty: i.qty }));
    const wh = resolveOrderWarehouse(items, avail);
    if (!wh) {
      results.push({ wisersellOrderId: c.wisersell_order_id, ok: false, status: 'skipped', message: 'Tek depodan tam karşılanmıyor (stok/iwasku)' });
      continue;
    }

    // OutboundOrder oluştur (idempotent: wisersellOrderId @unique)
    let orderId: string;
    try {
      const created = await prisma.$transaction(async (tx) => {
        const order = await tx.outboundOrder.create({
          data: {
            warehouseCode: wh,
            orderType: 'SINGLE',
            marketplaceCode: sm.marketplace_code!,
            orderNumber: c.order_code,
            addressNote: buildAddressNote(c, sm.label_prefix),
            status: 'DRAFT',
            source: 'WISERSELL_AUTO',
            wisersellOrderId: c.wisersell_order_id,
            createdById: userId,
          },
        });
        await tx.outboundOrderItem.createMany({
          data: items.map((it) => ({ outboundOrderId: order.id, iwasku: it.iwasku!, quantity: it.qty })),
        });
        return order;
      });
      orderId = created.id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // unique violation → zaten onaylı / numara çakışması
      results.push({ wisersellOrderId: c.wisersell_order_id, ok: false, status: 'skipped', message: `Oluşturulamadı (muhtemelen zaten var): ${msg.slice(0, 120)}` });
      continue;
    }

    // mark-ready (dış aksiyon) — başarısızsa ready-pending bırak
    try {
      await markWisersellReady([c.wisersell_order_id]);
      await prisma.outboundOrder.update({ where: { id: orderId }, data: { wisersellReadyAt: new Date() } });
      results.push({ wisersellOrderId: c.wisersell_order_id, ok: true, status: 'approved', warehouse: wh, orderId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`mark-ready başarısız (order ${c.wisersell_order_id}), ready-pending: ${msg}`);
      results.push({ wisersellOrderId: c.wisersell_order_id, ok: true, status: 'ready_pending', warehouse: wh, orderId, message: `Outbound oluştu ama Kargoya Hazır yazılamadı (retry): ${msg.slice(0, 120)}` });
    }
  }

  return results;
}
