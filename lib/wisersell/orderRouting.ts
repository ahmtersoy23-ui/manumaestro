/**
 * Wisersell adayı için depo yönlendirme: tek depodan TAM karşılama (depolar arası bölme YOK).
 *
 * Ağır ürünler (TÜM kalemler heavy: Mobilya/Alsat ≥4 desi, diğer ≥7) CastleGate'te tutulur →
 * önce CG (Shukran→MDN), sonra Fairfield (SHOWROOM) → Somerset (NJ). Heavy değilse direkt
 * Fairfield → Somerset. Hiçbiri tam karşılamıyor / iwasku eksik → null (pas geç / gizle).
 *
 * cgAvail verilmezse CG denenmez (geriye dönük uyumlu).
 */

import { isHeavyItem } from '@/lib/products/lookup';
import type { CgAvailability } from '@/lib/wms/cgStock';

export type RoutedWarehouse = 'CG_SHUKRAN' | 'CG_MDN' | 'SHOWROOM' | 'NJ';

export interface RoutingItem {
  iwasku: string | null;
  qty: number;
  desi?: number | null;
  category?: string | null;
}

export function resolveOrderWarehouse(
  items: RoutingItem[],
  usAvail: Map<string, { NJ: number; SHOWROOM: number }>,
  cgAvail?: Map<string, CgAvailability>,
): RoutedWarehouse | null {
  if (!items.length) return null;
  if (items.some((it) => !it.iwasku)) return null; // iwasku çözülememiş kalem → karşılanamaz

  const need = new Map<string, number>();
  for (const it of items) need.set(it.iwasku!, (need.get(it.iwasku!) ?? 0) + it.qty);
  const entries = [...need.entries()];

  // Heavy = TÜM kalemler eşik üstü. Sadece o zaman CG önceliklenir.
  const heavy = cgAvail != null && items.every((it) => isHeavyItem(it.category, it.desi));
  if (heavy) {
    const coversCg = (acc: keyof CgAvailability) =>
      entries.every(([iwasku, qty]) => (cgAvail!.get(iwasku)?.[acc] ?? 0) >= qty);
    if (coversCg('CG_SHUKRAN')) return 'CG_SHUKRAN';
    if (coversCg('CG_MDN')) return 'CG_MDN';
  }

  const coversUs = (wh: 'NJ' | 'SHOWROOM') =>
    entries.every(([iwasku, qty]) => (usAvail.get(iwasku)?.[wh] ?? 0) >= qty);
  if (coversUs('SHOWROOM')) return 'SHOWROOM';
  if (coversUs('NJ')) return 'NJ';
  return null;
}

/** Sipariş Mobilya kalemi içeriyor mu. */
export function isFurnitureOrder(items: RoutingItem[]): boolean {
  return items.some((it) => (it.category ?? '').trim().toLowerCase() === 'mobilya');
}

/**
 * Onayda manuel kaynak seçimi (TR/depo) gerektiren pazar yerleri.
 * NOT: Bu kod Wisersell store_map.marketplace_code'tur (aday akışı), ManuMaestro
 * iç registry değil → Amazon Citi = 'Ama_CITI' (CUSTOM_01 değil). İkisi de eklendi.
 */
const MANUAL_SOURCE_MARKETPLACES = new Set(['Ama_CITI', 'CUSTOM_01']); // Amazon Citi

/**
 * Onayda manuel kaynak seçimi (TR varsayılan + karşılayan depolar) gerekir mi?
 * Mobilya kalemi VEYA özel pazar yeri (Amazon Citi). Diğerleri otomatik routing.
 */
export function needsManualSource(items: RoutingItem[], marketplaceCode?: string | null): boolean {
  return isFurnitureOrder(items) || (!!marketplaceCode && MANUAL_SOURCE_MARKETPLACES.has(marketplaceCode));
}

/**
 * Etsy kanalı mı (tüm Etsy mağazaları: Etsy_BMU, EtsyDHA, "Etsy IWA", Etsy_SG ...)?
 * Otomatik onaydan muaf — US-uygunluk insan kontrolü gerektirir (ileride ürün-bazlı
 * US filtresi buraya bağlanır). needsManualSource'tan AYRI: kaynak dropdown'ı tetiklemez,
 * sadece "Onay Bekliyor"da manuel onayda kalır.
 */
export function isEtsyChannel(marketplaceCode?: string | null): boolean {
  return !!marketplaceCode && /^etsy/i.test(marketplaceCode.trim());
}

/**
 * Wayfair kanalı mı (mağaza: "Wayfair Shukran" / "Wayfair MDN")? Bu, o mağazanın
 * DROPSHIP siparişi — MCF/CastleGate DEĞİL. TR'den çıkmaz; daima US deposundan (NJ/SHOWROOM)
 * toplanır (heavy olsa bile CG'ye gitmez), Wayfair'in kendi etiketiyle gönderilir (Veeqo yok),
 * tracking elle girilir. Board'da ayrı "Wayfair" kolonu. Routing'de cgAvail=undefined verilir.
 * NOT: warehouseCode CG_SHUKRAN/CG_MDN (fulfillment deposu) ile KARIŞTIRMA — bu satış kanalı.
 */
export function isWayfairChannel(marketplaceCode?: string | null): boolean {
  return !!marketplaceCode && /^wayfair/i.test(marketplaceCode.trim());
}

/**
 * Mobilya manuel seçimi: tek depodan TAM karşılayabilen BÜTÜN depolar (sıra: Fairfield,
 * Somerset, CG Shukran, CG MDN). resolveOrderWarehouse'tan farkı: tek seçim değil, hepsi.
 * iwasku eksik / kalem yok → [] (zaten board'da gizlenir).
 */
export function resolveOrderWarehouseOptions(
  items: RoutingItem[],
  usAvail: Map<string, { NJ: number; SHOWROOM: number }>,
  cgAvail?: Map<string, CgAvailability>,
): RoutedWarehouse[] {
  if (!items.length || items.some((it) => !it.iwasku)) return [];

  const need = new Map<string, number>();
  for (const it of items) need.set(it.iwasku!, (need.get(it.iwasku!) ?? 0) + it.qty);
  const entries = [...need.entries()];

  const coversUs = (wh: 'NJ' | 'SHOWROOM') =>
    entries.every(([iwasku, qty]) => (usAvail.get(iwasku)?.[wh] ?? 0) >= qty);
  const coversCg = (acc: keyof CgAvailability) =>
    cgAvail != null && entries.every(([iwasku, qty]) => (cgAvail.get(iwasku)?.[acc] ?? 0) >= qty);

  const out: RoutedWarehouse[] = [];
  if (coversUs('SHOWROOM')) out.push('SHOWROOM');
  if (coversUs('NJ')) out.push('NJ');
  if (coversCg('CG_SHUKRAN')) out.push('CG_SHUKRAN');
  if (coversCg('CG_MDN')) out.push('CG_MDN');
  return out;
}
