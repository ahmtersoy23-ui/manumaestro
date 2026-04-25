/**
 * Product name/category lookup — pricelab_db.products tablosundan iwasku başına
 * bilgileri batch olarak getirir. Read-only kullanım.
 */

import { queryProductDb } from '@/lib/db/prisma';

export interface ProductInfo {
  iwasku: string;
  name: string;
  category: string | null;
}

export async function getProductsByIwasku(iwaskus: string[]): Promise<Map<string, ProductInfo>> {
  const map = new Map<string, ProductInfo>();
  if (iwaskus.length === 0) return map;

  const unique = [...new Set(iwaskus)];
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(',');
  const rows = await queryProductDb(
    `SELECT product_sku AS iwasku, name, category
     FROM products
     WHERE product_sku IN (${placeholders})`,
    unique
  );

  for (const r of rows as Array<{ iwasku: string; name: string; category: string | null }>) {
    map.set(r.iwasku, { iwasku: r.iwasku, name: r.name, category: r.category });
  }
  return map;
}
