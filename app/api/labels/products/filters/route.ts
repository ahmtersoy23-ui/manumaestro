/**
 * Etiket basım sayfası filtre listeleri.
 *
 * GET /api/labels/products/filters?category=...
 * - category yoksa: { categories: [...], parents: [] } (parent listesi büyük olduğundan
 *   önce kategori seçimi beklenir)
 * - category varsa: { categories: [...], parents: [...o kategorinin parent'ları...] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryProductDb } from '@/lib/db/prisma';
import { verifyAuth } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request);
    if (!authResult.success || !authResult.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

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

    return NextResponse.json({
      success: true,
      data: {
        categories: categoryRows.map((r) => r.value),
        parents: parentRows.map((r) => r.value),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
