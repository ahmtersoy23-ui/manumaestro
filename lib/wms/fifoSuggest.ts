/**
 * FIFO pick suggestion engine.
 *
 * Hedef miktar verildiğinde, mevcut konumlardan (raf stocks + koliler)
 * en eskiden başlayarak split önerisi üretir.
 *
 * Sıralama kuralı:
 *   1. Yaş ASC (eski önce)
 *      - ShelfStock: createdAt (kayıt oluşturma — quantity değişse de sabit)
 *      - ShelfBox: arrivedAt (paket depoya geliş)
 *   2. Aynı tarih ise NORMAL > POOL > TEMP (forward zone önce)
 *   3. Tek konumdan tamamen karşılanabiliyorsa, split yerine o konum öncelikli
 */

export type LocationSource = 'STOCK' | 'BOX';

export interface PickCandidate {
  source: LocationSource;
  locationId: string; // ShelfStock.id veya ShelfBox.id
  shelfId: string;
  shelfCode: string;
  shelfType: string; // POOL | NORMAL | TEMP
  availableQty: number;
  ageReference: Date; // FIFO için
  // Sadece BOX:
  boxNumber?: string;
  fnsku?: string | null;
  marketplaceCode?: string | null;
  status?: string;
}

export interface PickSuggestion {
  order: number;
  source: LocationSource;
  locationId: string;
  shelfCode: string;
  suggestedQty: number;
  availableQty: number;
  ageDays: number;
  rationale: string;
  boxNumber?: string;
}

const ZONE_PRIORITY: Record<string, number> = {
  NORMAL: 0, // En öncelikli (forward pick)
  POOL: 1, // Genel havuz
  TEMP: 2, // Geçici
};

/**
 * FIFO sıralı candidate listesi döndür.
 */
export function sortByFifo(candidates: PickCandidate[]): PickCandidate[] {
  return [...candidates].sort((a, b) => {
    const ageDiff = a.ageReference.getTime() - b.ageReference.getTime();
    if (ageDiff !== 0) return ageDiff;
    const za = ZONE_PRIORITY[a.shelfType] ?? 99;
    const zb = ZONE_PRIORITY[b.shelfType] ?? 99;
    if (za !== zb) return za - zb;
    return a.shelfCode.localeCompare(b.shelfCode);
  });
}

/**
 * Hedef miktar için FIFO sıralı split önerisi.
 *
 * "Single-location bias": Tek konum hedef miktarın tamamını karşılayabiliyorsa,
 * çoklu konum split etmek yerine en eski single-location'ı tercih et.
 */
export function suggestPick(
  candidates: PickCandidate[],
  qtyNeeded: number,
  now: Date = new Date()
): { suggestions: PickSuggestion[]; remaining: number } {
  if (qtyNeeded <= 0 || candidates.length === 0) {
    return { suggestions: [], remaining: qtyNeeded };
  }

  const sorted = sortByFifo(candidates);

  // Single-location bias: Tek konum tamamen karşılayabiliyorsa onu seç (en eski olanı).
  const singleCovers = sorted.find((c) => c.availableQty >= qtyNeeded);
  if (singleCovers) {
    return {
      suggestions: [
        {
          order: 1,
          source: singleCovers.source,
          locationId: singleCovers.locationId,
          shelfCode: singleCovers.shelfCode,
          suggestedQty: qtyNeeded,
          availableQty: singleCovers.availableQty,
          ageDays: ageDaysFrom(singleCovers.ageReference, now),
          rationale: rationaleFor(singleCovers, now, true),
          boxNumber: singleCovers.boxNumber,
        },
      ],
      remaining: 0,
    };
  }

  // Çoklu konum split — FIFO sırasına göre topla
  const suggestions: PickSuggestion[] = [];
  let remaining = qtyNeeded;
  let order = 1;
  for (const c of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(c.availableQty, remaining);
    if (take <= 0) continue;
    suggestions.push({
      order: order++,
      source: c.source,
      locationId: c.locationId,
      shelfCode: c.shelfCode,
      suggestedQty: take,
      availableQty: c.availableQty,
      ageDays: ageDaysFrom(c.ageReference, now),
      rationale: rationaleFor(c, now, false),
      boxNumber: c.boxNumber,
    });
    remaining -= take;
  }

  return { suggestions, remaining: Math.max(0, remaining) };
}

function ageDaysFrom(ref: Date, now: Date): number {
  const ms = now.getTime() - ref.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function rationaleFor(c: PickCandidate, now: Date, single: boolean): string {
  const days = ageDaysFrom(c.ageReference, now);
  const ageStr = days === 0 ? 'bugün' : `${days} gün önce`;
  const zoneStr = c.shelfType === 'NORMAL' ? 'forward' : c.shelfType.toLowerCase();
  if (single) return `Tek konum, ${ageStr} (${zoneStr})`;
  if (c.source === 'BOX') return `Koli ${c.boxNumber}, ${ageStr} (${zoneStr})`;
  return `${ageStr} (${zoneStr})`;
}
