/**
 * Depo kodları (backend) → kullanıcı dostu isimler (UI).
 * Backend kodları SABİT kalır (NJ, SHOWROOM, ANKARA); UI'da bunlar yerine
 * "Somerset" / "Fairfield" / "Ankara" gösterilir.
 */

export const WAREHOUSE_LABELS: Record<string, string> = {
  ANKARA: 'Ankara',
  NJ: 'Somerset',
  SHOWROOM: 'Fairfield',
};

export const WAREHOUSE_LABELS_LONG: Record<string, string> = {
  ANKARA: 'Ankara Depo',
  NJ: 'Somerset Depo',
  SHOWROOM: 'Fairfield Depo',
};

export function warehouseLabel(code: string): string {
  return WAREHOUSE_LABELS[code] ?? code;
}

export function warehouseLabelLong(code: string): string {
  return WAREHOUSE_LABELS_LONG[code] ?? code;
}

/* ────────────────── URL slug ↔ backend code ──────────────────
 * Backend tabloları ve API path'leri SABİT (ANKARA / NJ / SHOWROOM).
 * URL'de okunan parça ise human-friendly slug:
 *   ankara → ANKARA, somerset → NJ, fairfield → SHOWROOM.
 * Eski büyük-harf URL'ler (NJ/SHOWROOM) layout'ta yeni slug'a redirect olur.
 */

export const SLUG_TO_CODE: Record<string, string> = {
  ankara: 'ANKARA',
  somerset: 'NJ',
  fairfield: 'SHOWROOM',
};

export const CODE_TO_SLUG: Record<string, string> = {
  ANKARA: 'ankara',
  NJ: 'somerset',
  SHOWROOM: 'fairfield',
};

/** URL slug → backend code; bilinmeyense null. */
export function slugToCode(slug: string): string | null {
  return SLUG_TO_CODE[slug.toLowerCase()] ?? null;
}

/** Backend code → URL slug (yoksa lowercase fallback). */
export function codeToSlug(code: string): string {
  return CODE_TO_SLUG[code.toUpperCase()] ?? code.toLowerCase();
}

/** URL parametresi backend code mu? (eski büyük-harf URL geriye uyum) */
export function isLegacyCode(value: string): boolean {
  return value === value.toUpperCase() && value in CODE_TO_SLUG;
}
