/**
 * CastleGate (CG) stoğu — 2 Wayfair hesabı: Shukran (fba_inventory WFS) + MDN (WFM).
 * Ağır ürünler (≥7 desi / Mobilya-Alsat ≥4) fiziksel olarak burada; sipariş routing'inde
 * NJ/SHOWROOM'dan ÖNCE kontrol edilir. Kaynak pricelab_db (DataBridge Wayfair sync).
 */

import { queryProductDb } from '@/lib/db/prisma';

export interface CgAvailability {
  CG_SHUKRAN: number; // WFS
  CG_MDN: number; // WFM
}

/** Verilen iwasku'lar için CG (Shukran=WFS + MDN=WFM) fulfillable stoğu. */
export async function getCgAvailability(iwaskus: string[]): Promise<Map<string, CgAvailability>> {
  const result = new Map<string, CgAvailability>();
  const unique = [...new Set(iwaskus.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return result;

  const placeholders = unique.map((_, i) => `$${i + 1}`).join(',');
  const rows = (await queryProductDb(
    `SELECT iwasku,
            SUM(CASE WHEN warehouse='WFS' THEN fulfillable_quantity ELSE 0 END)::int AS shukran,
            SUM(CASE WHEN warehouse='WFM' THEN fulfillable_quantity ELSE 0 END)::int AS mdn
     FROM fba_inventory
     WHERE warehouse IN ('WFS','WFM') AND iwasku IN (${placeholders})
     GROUP BY iwasku`,
    unique,
  )) as Array<{ iwasku: string; shukran: number; mdn: number }>;

  for (const r of rows) {
    result.set(r.iwasku, { CG_SHUKRAN: Math.max(0, r.shukran ?? 0), CG_MDN: Math.max(0, r.mdn ?? 0) });
  }
  return result;
}
