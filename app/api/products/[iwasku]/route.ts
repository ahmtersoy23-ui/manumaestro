/**
 * Get Product by IWASKU API
 * Retrieves a single product from pricelab_db.products table
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryProductDb } from '@/lib/db/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ iwasku: string }> }
) {
  try {
    const { iwasku } = await params;

    if (!iwasku) {
      return NextResponse.json(
        { error: 'IWASKU is required' },
        { status: 400 }
      );
    }

    // Query single product from pricelab_db
    const products = await queryProductDb(`
      SELECT
        product_sku as iwasku,
        name,
        parent as category
      FROM products
      WHERE product_sku = $1
      LIMIT 1
    `, [iwasku]);

    if (products.length === 0) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: products[0],
    });
  } catch (error) {
    console.error('Product fetch error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch product',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
