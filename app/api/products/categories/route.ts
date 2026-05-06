/**
 * GET /api/products/categories
 * pricelab_db.products tablosundaki tüm farklı kategorileri döner.
 * UI dropdown'larında ürün arama filtresi için kullanılır.
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryProductDb } from '@/lib/db/prisma';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { verifyAuth } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await rateLimiters.read.check(request, 'product-categories');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const rows = (await queryProductDb(`
      SELECT DISTINCT category
      FROM products
      WHERE category IS NOT NULL AND category <> ''
      ORDER BY category
    `)) as Array<{ category: string }>;

    return NextResponse.json({
      success: true,
      data: rows.map((r) => r.category),
    });
  } catch (error) {
    return errorResponse(error, 'Kategori listesi alınamadı');
  }
}
