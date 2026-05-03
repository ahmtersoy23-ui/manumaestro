/**
 * Etiket basım sayfası için ürün listesi (search + kategori + parent + pagination).
 *
 * GET /api/labels/products?search=...&category=...&parent=...&page=1
 * pricelab_db.products tablosundan filtreli arama. Sayfa başına 50 sonuç.
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryProductDb } from '@/lib/db/prisma';
import { verifyAuth } from '@/lib/auth/verify';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { errorResponse } from '@/lib/api/response';

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await rateLimiters.read.check(request, 'list-label-products');
    if (!rateLimitResult.success) return rateLimitExceededResponse(rateLimitResult);

    const authResult = await verifyAuth(request);
    if (!authResult.success || !authResult.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const search = (sp.get('search') || '').trim().slice(0, 100);
    const category = (sp.get('category') || '').trim().slice(0, 200);
    const parent = (sp.get('parent') || '').trim().slice(0, 200);
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    // WHERE clause'ı dinamik kur
    const conditions: string[] = ['product_sku IS NOT NULL', 'name IS NOT NULL'];
    const params: (string | number)[] = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(LOWER(product_sku) LIKE LOWER($${params.length}) OR LOWER(name) LIKE LOWER($${params.length}))`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (parent) {
      params.push(parent);
      conditions.push(`parent = $${params.length}`);
    }

    const whereSql = conditions.join(' AND ');

    type Row = { iwasku: string; product_name: string; category: string | null; parent: string | null };
    type CountRow = { count: string };

    // Total count
    const countResult = (await queryProductDb(
      `SELECT COUNT(*) AS count FROM products WHERE ${whereSql}`,
      params
    )) as CountRow[];
    const total = parseInt(countResult[0].count, 10);

    // Page rows
    params.push(PAGE_SIZE, offset);
    const rows = (await queryProductDb(
      `SELECT product_sku AS iwasku, name AS product_name, category, parent
       FROM products
       WHERE ${whereSql}
       ORDER BY name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )) as Row[];

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return NextResponse.json({
      success: true,
      data: rows,
      pagination: { page, pageSize: PAGE_SIZE, total, totalPages },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
