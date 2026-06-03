/**
 * Deniz sevkiyatı ETA (tahmini varış) uyarı rozeti.
 *
 * Teslim olmamış (status != DELIVERED) + etaDate'li DENİZ sevkiyatlarında:
 *   - ETA geçmişse → kırmızı "ETA N gün geçti"
 *   - ETA'ya ≤ ETA_WARN_DAYS gün kala → amber "Varışa N gün" / "ETA bugün"
 *   - aksi halde rozet yok (null)
 * Kara/hava ve teslim edilmişlerde rozet gösterilmez.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const ETA_WARN_DAYS = 3;

export interface EtaBadge {
  tone: 'red' | 'amber';
  text: string;
  days: number; // ETA'ya kalan gün (negatif = geçmiş)
}

export function seaEtaBadge(
  etaIso: string | null | undefined,
  shippingMethod: string,
  status: string,
  now: Date = new Date()
): EtaBadge | null {
  if (shippingMethod !== 'sea' || status === 'DELIVERED' || !etaIso) return null;
  const eta = new Date(etaIso);
  if (Number.isNaN(eta.getTime())) return null;

  const midUTC = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((midUTC(eta) - midUTC(now)) / DAY_MS);

  if (days < 0) return { tone: 'red', text: `ETA ${-days} gün geçti`, days };
  if (days <= ETA_WARN_DAYS) {
    return { tone: 'amber', text: days === 0 ? 'ETA bugün' : `Varışa ${days} gün`, days };
  }
  return null;
}
