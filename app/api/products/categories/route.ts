/**
 * GET /api/products/categories
 * pricelab_db.products tablosundaki tüm farklı kategorileri döner.
 * UI dropdown'larında ürün arama filtresi için kullanılır.
 */

import { queryProductDb } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Kategori listesi alınamadı' },
  async () => {
    const rows = (await queryProductDb(`
      SELECT DISTINCT category
      FROM products
      WHERE category IS NOT NULL AND category <> ''
      ORDER BY category
    `)) as Array<{ category: string }>;

    return successResponse(rows.map((r) => r.category));
  }
);
