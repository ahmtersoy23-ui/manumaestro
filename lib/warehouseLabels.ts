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
