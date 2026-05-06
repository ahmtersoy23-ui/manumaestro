/**
 * Products Search API
 * Searches products from pricelab_db.products table
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryProductDb } from '@/lib/db/prisma';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { verifyAuth } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting: 200 requests per minute for read operations
    const rateLimitResult = await rateLimiters.read.check(request, 'search-products');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication: Require any authenticated user
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const category = searchParams.get('category')?.trim() || null;

    // Kategori filtresi varsa q opsiyonel; yoksa eskisi gibi q zorunlu (en az 2)
    if (!category && (!query || query.length < 2)) {
      return NextResponse.json(
        { error: 'Arama sorgusu en az 2 karakter olmalı (veya kategori seçin)' },
        { status: 400 }
      );
    }

    // Dinamik WHERE ve params
    const conditions: string[] = [];
    const params: (string | null)[] = [];
    if (query && query.length >= 2) {
      const pat = `%${query}%`;
      params.push(pat, pat);
      conditions.push(`(product_sku ILIKE $${params.length - 1} OR name ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const products = await queryProductDb(
      `
      SELECT
        product_sku as iwasku,
        name,
        category,
        COALESCE(manual_size, size) as size
      FROM products
      ${whereSql}
      ORDER BY name
      LIMIT 50
    `,
      params
    );

    return NextResponse.json({
      success: true,
      data: products,
    });
  } catch (error) {
    return errorResponse(error, 'Ürün araması başarısız');
  }
}
