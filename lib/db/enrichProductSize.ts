/**
 * Enrich productSize from pricelab_db (tek kaynak)
 * Tüm desi hesaplamaları bu fonksiyon üzerinden geçmeli.
 */

import { queryProductDb } from './prisma';

interface HasProductSize {
  iwasku: string;
  productSize: number | null;
}

export async function enrichProductSize<T extends HasProductSize>(items: T[]): Promise<void> {
  const allSkus = [...new Set(items.map(r => r.iwasku))];
  if (allSkus.length === 0) return;

  const placeholders = allSkus.map((_, i) => `$${i + 1}`).join(',');
  const products = await queryProductDb(
    `SELECT product_sku, COALESCE(manual_size, size) as size FROM products WHERE product_sku IN (${placeholders}) AND COALESCE(manual_size, size) IS NOT NULL`,
    allSkus
  );
  const sizeMap = new Map(
    products.map((p: { product_sku: string; size: number }) => [p.product_sku, p.size])
  );

  for (const item of items) {
    if (sizeMap.has(item.iwasku)) {
      (item as { productSize: number | null }).productSize = sizeMap.get(item.iwasku)!;
    }
  }
}
