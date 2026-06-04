/**
 * Wisersell adayı için depo yönlendirme: tek depodan (Fairfield öncelik, yoksa Somerset)
 * TAM karşılama kuralı. Depolar arası bölme YOK — kısmi/iwasku eksik → null (pas geç).
 */

import type { UsWarehouse } from '@/lib/wms/usWarehouseStock';

export function resolveOrderWarehouse(
  items: { iwasku: string | null; qty: number }[],
  availMap: Map<string, { NJ: number; SHOWROOM: number }>,
): UsWarehouse | null {
  if (!items.length) return null;
  if (items.some((it) => !it.iwasku)) return null; // iwasku çözülememiş kalem → karşılanamaz

  const need = new Map<string, number>();
  for (const it of items) need.set(it.iwasku!, (need.get(it.iwasku!) ?? 0) + it.qty);

  const coversAll = (wh: UsWarehouse) =>
    [...need.entries()].every(([iwasku, qty]) => (availMap.get(iwasku)?.[wh] ?? 0) >= qty);

  if (coversAll('SHOWROOM')) return 'SHOWROOM';
  if (coversAll('NJ')) return 'NJ';
  return null;
}
