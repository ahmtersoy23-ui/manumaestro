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
      `SELECT iwasku, MIN(asin) AS asin
       FROM sku_master
       WHERE iwasku IN (${placeholders}) AND asin IS NOT NULL
       GROUP BY iwasku`,
      unique
    ),
  ]);

  const asinMap = new Map<string, string>();
  for (const r of asinRows as Array<{ iwasku: string; asin: string }>) {
    asinMap.set(r.iwasku, r.asin);
  }

  for (const r of productRows as Array<{ iwasku: string; name: string | null; category: string | null }>) {
    map.set(r.iwasku, {
      iwasku: r.iwasku,
      name: r.name,
      category: r.category,
      asin: asinMap.get(r.iwasku) ?? null,
    });
  }
  // products'ta olmayan ama sku_master'da olanlar için entry
  for (const [iwasku, asin] of asinMap.entries()) {
    if (!map.has(iwasku)) {
      map.set(iwasku, { iwasku, name: null, category: null, asin });
    }
  }
  return map;
}
