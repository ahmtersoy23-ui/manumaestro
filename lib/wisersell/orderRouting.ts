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
