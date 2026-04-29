/**
 * Enrich productSize ve productName from pricelab_db (tek kaynak).
 * production_requests'teki cache'ler bayatlayabilir; UI'da pricelab.products
 * canlı değerleri gösterilsin diye listeleme endpoint'leri bu fonksiyonu çağırır.
 */

import { queryProductDb } from './prisma';

interface HasIwasku {
  iwasku: string;
  productSize: number | null;
  productName?: string;
}

export async function enrichProductSize<T extends HasIwasku>(items: T[]): Promise<void> {
  const allSkus = [...new Set(items.map(r => r.iwasku))];
  if (allSkus.length === 0) return;

  const placeholders = allSkus.map((_, i) => `$${i + 1}`).join(',');
  const products = await queryProductDb(
    `SELECT product_sku, COALESCE(manual_size, size) as size, name FROM products WHERE product_sku IN (${placeholders})`,
    allSkus
  );
  const productMap = new Map(
    products.map((p: { product_sku: string; size: number | null; name: string | null }) => [
      p.product_sku,
      { size: p.size, name: p.name },
    ])
  );

  for (const item of items) {
    const product = productMap.get(item.iwasku);
    if (!product) continue;
    if (product.size != null) {
      (item as { productSize: number | null }).productSize = Number(product.size);
    }
    if (product.name && 'productName' in item) {
      (item as { productName: string }).productName = product.name;
    }
  }
}
