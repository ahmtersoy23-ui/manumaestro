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
}

export async function getProductsByIwasku(iwaskus: string[]): Promise<Map<string, ProductInfo>> {
  const map = new Map<string, ProductInfo>();
  if (iwaskus.length === 0) return map;

  const unique = [...new Set(iwaskus)];
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(',');

  const [productRows, asinRows] = await Promise.all([
    queryProductDb(
      `SELECT product_sku AS iwasku, name, category
       FROM products
       WHERE product_sku IN (${placeholders})`,
      unique
    ),
    queryProductDb(
      `SELECT iwasku,
              MIN(asin) FILTER (WHERE asin IS NOT NULL) AS asin,
              string_agg(DISTINCT fnsku, ', ') FILTER (WHERE fnsku IS NOT NULL) AS fnsku
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

  for (const r of productRows as Array<{ iwasku: string; name: string | null; category: string | null }>) {
    const sku = skuMap.get(r.iwasku);
    map.set(r.iwasku, {
      iwasku: r.iwasku,
      name: r.name,
      category: r.category,
      asin: sku?.asin ?? null,
      fnsku: sku?.fnsku ?? null,
    });
  }
  // products'ta olmayan ama sku_master'da olanlar için entry
  for (const [iwasku, sku] of skuMap.entries()) {
    if (!map.has(iwasku)) {
      map.set(iwasku, { iwasku, name: null, category: null, asin: sku.asin, fnsku: sku.fnsku });
    }
  }
  return map;
}
