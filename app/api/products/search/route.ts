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
        { success: false, error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json(
        { error: 'Search query must be at least 2 characters' },
        { status: 400 }
      );
    }

    // Query the products table from pricelab_db
    const searchPattern = `%${query}%`;
    const products = await queryProductDb(`
      SELECT
        product_sku as iwasku,
        name,
        category,
        size
      FROM products
      WHERE
        product_sku ILIKE $1
        OR name ILIKE $2
      LIMIT 20
    `, [searchPattern, searchPattern]);

    return NextResponse.json({
      success: true,
      data: products,
    });
  } catch (error) {
    return errorResponse(error, 'Failed to search products');
  }
}
