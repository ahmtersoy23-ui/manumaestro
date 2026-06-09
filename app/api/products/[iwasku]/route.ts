/**
 * Get Product by IWASKU API
 * Retrieves a single product from pricelab_db.products table
 */

import { NextResponse } from 'next/server';
import { queryProductDb } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute<{ iwasku: string }>(
  { rateLimit: 'read', fallbackMessage: 'Ürün getirilemedi' },
  async ({ params }) => {
    const { iwasku } = params;

    if (!iwasku) {
      return NextResponse.json(
        { error: 'IWASKU gereklidir' },
        { status: 400 }
      );
    }

    // Query single product from pricelab_db
    const products = await queryProductDb(`
      SELECT
        product_sku as iwasku,
        name,
        category,
        size
      FROM products
      WHERE product_sku = $1
      LIMIT 1
    `, [iwasku]);

    if (products.length === 0) {
      return NextResponse.json(
        { error: 'Ürün bulunamadı' },
        { status: 404 }
      );
    }

    return successResponse(products[0]);
  }
);
