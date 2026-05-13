/**
 * Etiket basım sayfası filtre listeleri.
 *
 * GET /api/labels/products/filters?category=...
 * - category yoksa: { categories: [...], parents: [] } (parent listesi büyük olduğundan
 *   önce kategori seçimi beklenir)
 * - category varsa: { categories: [...], parents: [...o kategorinin parent'ları...] }
 */

import { queryProductDb } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Filtreler getirilemedi' },
  async ({ request }) => {
    const category = (request.nextUrl.searchParams.get('category') || '').trim().slice(0, 200);

    type StrRow = { value: string };

    const categoryRows = (await queryProductDb(
      `SELECT DISTINCT category AS value FROM products
       WHERE category IS NOT NULL AND category <> ''
       ORDER BY value`,
      []
    )) as StrRow[];

    let parentRows: StrRow[] = [];
    if (category) {
      parentRows = (await queryProductDb(
        `SELECT DISTINCT parent AS value FROM products
         WHERE category = $1 AND parent IS NOT NULL AND parent <> ''
         ORDER BY value`,
        [category]
      )) as StrRow[];
    }

    return successResponse({
      categories: categoryRows.map((r) => r.value),
      parents: parentRows.map((r) => r.value),
    });
  }
);
