/**
 * US depoları (Somerset=NJ + Fairfield=SHOWROOM) için sipariş çıkış stok kuralı.
 *
 * Sipariş çıkış girilirken bir ürünün hangi depodan sevk edilmesi gerektiğini
 * belirler. Öncelik FAIRFIELD (SHOWROOM): bir kalem ancak doğru depodan
 * girilebilir, yanlış depodan giriş bloklanır.
 *
 * Kural (istenen adet = qty, kullanılabilir = quantity - reservedQty):
 *   1. İki depoda da kullanılabilir stok yok → hiçbir yerde yok (tamamen blok).
 *   2. Fairfield'da qty kadar var → doğru depo Fairfield.
 *   3. Değilse Somerset'te qty kadar var → doğru depo Somerset.
 *   4. İkisi de tek başına yetmiyor → en çok stoğu olan (eşitlik → Fairfield);
 *      "yetersiz" işaretiyle yine de izin verilir (ikaz).
 */

import { prisma } from '@/lib/db/prisma';
import { warehouseLabel } from '@/lib/warehouseLabels';

export const US_OUTBOUND_WAREHOUSES = ['NJ', 'SHOWROOM'] as const;
export type UsWarehouse = (typeof US_OUTBOUND_WAREHOUSES)[number];

export interface UsAvailability {
  NJ: number;
  SHOWROOM: number;
}

export interface OutboundResolution {
  /** Bu kalemin girilmesi gereken depo; null = hiçbir US deposunda stok yok. */
  correct: UsWarehouse | null;
  /** correct depo, istenen adedi tek başına karşılıyor mu? */
  sufficient: boolean;
}

/**
 * Verilen iwasku'lar için NJ + SHOWROOM kullanılabilir stoğu (quantity - reservedQty)
 * tek sorguda toplar. Boş koliler (EMPTY) hariç. Negatif değerler 0'a sabitlenir.
 */
export async function getUsAvailability(
  iwaskus: string[],
  opts: { subtractPendingDraft?: boolean; excludeOrderId?: string } = {}
): Promise<Map<string, UsAvailability>> {
  const result = new Map<string, UsAvailability>();
  const unique = [...new Set(iwaskus.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return result;
  for (const iwasku of unique) result.set(iwasku, { NJ: 0, SHOWROOM: 0 });

  const [stocks, boxes] = await Promise.all([
    prisma.shelfStock.findMany({
      where: { warehouseCode: { in: [...US_OUTBOUND_WAREHOUSES] }, iwasku: { in: unique } },
      select: { warehouseCode: true, iwasku: true, quantity: true, reservedQty: true },
    }),
    prisma.shelfBox.findMany({
      where: {
        warehouseCode: { in: [...US_OUTBOUND_WAREHOUSES] },
        iwasku: { in: unique },
        status: { not: 'EMPTY' },
      },
      select: { warehouseCode: true, iwasku: true, quantity: true, reservedQty: true },
    }),
  ]);

  const add = (iwasku: string, code: string, available: number) => {
    const entry = result.get(iwasku);
    if (!entry || (code !== 'NJ' && code !== 'SHOWROOM')) return;
    entry[code] += Math.max(0, available);
  };
  for (const s of stocks) add(s.iwasku, s.warehouseCode, s.quantity - s.reservedQty);
  for (const b of boxes) add(b.iwasku, b.warehouseCode, b.quantity - b.reservedQty);

  // Sipariş-bazlı yumuşak rezerve: bekleyen DRAFT SINGLE sipariş miktarları
  // available'dan düşülür → over-commit engellenir. Stok tablosuna dokunmaz;
  // sipariş SHIPPED/CANCELLED/silinince otomatik serbest kalır.
  // excludeOrderId: düzenlenen siparişin kendi miktarını sayma (self-count önle).
  if (opts.subtractPendingDraft) {
    const pendingOrders = await prisma.outboundOrder.findMany({
      where: {
        status: 'DRAFT',
        orderType: 'SINGLE',
        warehouseCode: { in: [...US_OUTBOUND_WAREHOUSES] },
        ...(opts.excludeOrderId ? { id: { not: opts.excludeOrderId } } : {}),
        items: { some: { iwasku: { in: unique } } },
      },
      select: {
        warehouseCode: true,
        items: { where: { iwasku: { in: unique } }, select: { iwasku: true, quantity: true } },
      },
    });
    for (const o of pendingOrders) {
      if (o.warehouseCode !== 'NJ' && o.warehouseCode !== 'SHOWROOM') continue;
      for (const it of o.items) {
        const entry = result.get(it.iwasku);
        if (entry) entry[o.warehouseCode] = Math.max(0, entry[o.warehouseCode] - it.quantity);
      }
    }
  }

  return result;
}

/**
 * Ham ON-HAND stok (NJ + SHOWROOM) — reservedQty düşülmez, bekleyen sipariş sayılmaz.
 * Stok haritası gibi "fiziksel ne var" görünümleri için. iwasku verilmezse TÜM US depo
 * stoğunu döndürür. Boş koliler (EMPTY) hariç.
 */
export async function getUsOnHand(iwaskus?: string[]): Promise<Map<string, UsAvailability>> {
  const result = new Map<string, UsAvailability>();
  const unique = iwaskus ? [...new Set(iwaskus.map((s) => s.trim()).filter(Boolean))] : null;
  if (unique && unique.length === 0) return result;
  const iwaskuFilter = unique ? { iwasku: { in: unique } } : {};

  const [stocks, boxes] = await Promise.all([
    prisma.shelfStock.findMany({
      where: { warehouseCode: { in: [...US_OUTBOUND_WAREHOUSES] }, ...iwaskuFilter },
      select: { warehouseCode: true, iwasku: true, quantity: true },
    }),
    prisma.shelfBox.findMany({
      where: { warehouseCode: { in: [...US_OUTBOUND_WAREHOUSES] }, status: { not: 'EMPTY' }, ...iwaskuFilter },
      select: { warehouseCode: true, iwasku: true, quantity: true },
    }),
  ]);

  const add = (iwasku: string, code: string, qty: number) => {
    let entry = result.get(iwasku);
    if (!entry) { entry = { NJ: 0, SHOWROOM: 0 }; result.set(iwasku, entry); }
    if (code === 'NJ' || code === 'SHOWROOM') entry[code] += Math.max(0, qty);
  };
  for (const s of stocks) add(s.iwasku, s.warehouseCode, s.quantity);
  for (const b of boxes) add(b.iwasku, b.warehouseCode, b.quantity);

  return result;
}

/** Fairfield önceliğiyle bir kalemin hangi depoya gireceğini çözer. */
export function resolveOutboundWarehouse(
  avail: UsAvailability,
  qty: number
): OutboundResolution {
  const f = avail.SHOWROOM; // Fairfield — öncelik
  const s = avail.NJ; // Somerset
  if (f <= 0 && s <= 0) return { correct: null, sufficient: false };
  if (f >= qty) return { correct: 'SHOWROOM', sufficient: true };
  if (s >= qty) return { correct: 'NJ', sufficient: true };
  // İkisi de tek başına yetmiyor → en çok stoğu olan (eşitlik → Fairfield)
  return { correct: f >= s ? 'SHOWROOM' : 'NJ', sufficient: false };
}

/**
 * Hedef depoya bu kalemi girmek serbest mi?
 * Döner: null → serbest (doğru depo); aksi halde operatörü yönlendiren blok mesajı.
 * Not: "yetersiz ama doğru depo" durumu serbesttir (blok değil) — yalnızca ikaz frontend'de.
 */
export function outboundBlockMessage(
  target: UsWarehouse,
  iwasku: string,
  qty: number,
  avail: UsAvailability,
  resolution: OutboundResolution = resolveOutboundWarehouse(avail, qty)
): string | null {
  const { correct } = resolution;
  if (correct === null) {
    return `${iwasku}: Hiçbir US deposunda (Somerset/Fairfield) stok yok.`;
  }
  if (correct === target) return null;

  const correctLabel = warehouseLabel(correct);
  const correctQty = avail[correct];
  if (correct === 'SHOWROOM') {
    // Yanlış depo Somerset'e giriliyor, doğrusu Fairfield (öncelik)
    return `${iwasku}: Öncelik Fairfield — Fairfield'da ${correctQty} adet var, bu siparişi ${correctLabel} deposundan girin.`;
  }
  // correct === 'NJ': Fairfield'da yeterli yok, Somerset'te var
  return `${iwasku}: Fairfield'da yeterli stok yok (${avail.SHOWROOM} adet); Somerset'te ${correctQty} adet var — ${correctLabel} deposundan girin.`;
}
