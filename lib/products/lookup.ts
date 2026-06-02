/**
 * Product enrichment lookup — iwasku başına name/category (products) + asin (sku_master)
 * batch olarak getirir. Read-only.
 */

import { queryProductDb } from '@/lib/db/prisma';

export interface ProductInfo {
  iwasku: string;
  name: string | null;
  category: string | null;
  asin: string | null; // sku_master'dan distinct asin (varsa ilki)
  fnsku: string | null; // sku_master'dan distinct fnsku(lar), virgülle (varsa)
  // Katalog ölçüleri (products) — ham birim: cm + kg
  widthCm: number | null;
  heightCm: number | null;
  lengthCm: number | null;
  weightKg: number | null;
}

const CM_PER_INCH = 2.54;
const LB_PER_KG = 2.20462;

/** Katalog ölçülerini US birimine çevirir (inç + libre); hiç veri yoksa null. */
export function usDimensions(
  p: ProductInfo | null | undefined
): { lengthIn: number | null; widthIn: number | null; heightIn: number | null; weightLb: number | null } | null {
  if (!p) return null;
  const inch = (cm: number | null) => (cm == null ? null : Math.round((cm / CM_PER_INCH) * 10) / 10);
  const lengthIn = inch(p.lengthCm);
  const widthIn = inch(p.widthCm);
  const heightIn = inch(p.heightCm);
  const weightLb = p.weightKg == null ? null : Math.round(p.weightKg * LB_PER_KG * 10) / 10;
  if (lengthIn == null && widthIn == null && heightIn == null && weightLb == null) return null;
  return { lengthIn, widthIn, heightIn, weightLb };
}

export async function getProductsByIwasku(iwaskus: string[]): Promise<Map<string, ProductInfo>> {
  const map = new Map<string, ProductInfo>();
  if (iwaskus.length === 0) return map;

  const unique = [...new Set(iwaskus)];
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(',');

  const [productRows, asinRows] = await Promise.all([
    queryProductDb(
      `SELECT product_sku AS iwasku, name, category, width, height, length, weight
       FROM products
       WHERE product_sku IN (${placeholders})`,
      unique
    ),
    queryProductDb(
      `SELECT iwasku,
              MIN(asin) FILTER (WHERE asin IS NOT NULL) AS asin,
              string_agg(DISTINCT fnsku, ', ') FILTER (WHERE fnsku IS NOT NULL AND country_code = 'US') AS fnsku
       FROM sku_master
       WHERE iwasku IN (${placeholders})
       GROUP BY iwasku`,
      unique
    ),
  ]);

  const skuMap = new Map<string, { asin: string | null; fnsku: string | null }>();
  for (const r of asinRows as Array<{ iwasku: string; asin: string | null; fnsku: string | null }>) {
    skuMap.set(r.iwasku, { asin: r.asin, fnsku: r.fnsku });
  }

  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  for (const r of productRows as Array<{
    iwasku: string;
    name: string | null;
    category: string | null;
    width: unknown;
    height: unknown;
    length: unknown;
    weight: unknown;
  }>) {
    const sku = skuMap.get(r.iwasku);
    map.set(r.iwasku, {
      iwasku: r.iwasku,
      name: r.name,
      category: r.category,
      asin: sku?.asin ?? null,
      fnsku: sku?.fnsku ?? null,
      widthCm: num(r.width),
      heightCm: num(r.height),
      lengthCm: num(r.length),
      weightKg: num(r.weight),
    });
  }
  // products'ta olmayan ama sku_master'da olanlar için entry (ölçü yok)
  for (const [iwasku, sku] of skuMap.entries()) {
    if (!map.has(iwasku)) {
      map.set(iwasku, {
        iwasku,
        name: null,
        category: null,
        asin: sku.asin,
        fnsku: sku.fnsku,
        widthCm: null,
        heightCm: null,
        lengthCm: null,
        weightKg: null,
      });
    }
  }
  return map;
}
