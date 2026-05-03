/**
 * Etiket basım sayfası için ürün listesi (search ile).
 *
 * GET /api/labels/products?search=...
 * pricelab_db.products tablosundan iwasku/ad/category arar, ilk 50 satır döner.
 *
 * Bu endpoint sadece etiket basımı sayfası içindir — talep olmayan ürünleri de
 * etiketleyebilmek için tüm katalog erişimi sağlar.
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryProductDb } from '@/lib/db/prisma';
import { verifyAuth } from '@/lib/auth/verify';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { errorResponse } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await rateLimiters.read.check(request, 'list-label-products');
    if (!rateLimitResult.success) return rateLimitExceededResponse(rateLimitResult);

    const authResult = await verifyAuth(request);
    if (!authResult.success || !authResult.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const search = (request.nextUrl.searchParams.get('search') || '').trim().slice(0, 100);

    const limit = 50;
    type Row = { iwasku: string; product_name: string; category: string | null };

    let rows: Row[];
    if (search.length === 0) {
      rows = (await queryProductDb(
        `SELECT product_sku AS iwasku, name AS product_name, category
         FROM products
         WHERE product_sku IS NOT NULL AND name IS NOT NULL
         ORDER BY name
         LIMIT $1`,
        [limit]
      )) as Row[];
    } else {
      const pattern = `%${search}%`;
      rows = (await queryProductDb(
        `SELECT product_sku AS iwasku, name AS product_name, category
         FROM products
         WHERE product_sku IS NOT NULL AND name IS NOT NULL
           AND (LOWER(product_sku) LIKE LOWER($1) OR LOWER(name) LIKE LOWER($1))
         ORDER BY name
         LIMIT $2`,
        [pattern, limit]
      )) as Row[];
    }

    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
