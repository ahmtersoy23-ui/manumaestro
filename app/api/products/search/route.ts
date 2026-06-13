/**
 * Products Search API
 * Searches products from pricelab_db.products table
 */

import { NextResponse } from 'next/server';
import { queryProductDb } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Ürün araması başarısız' },
  async ({ request }) => {
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

    // FNSKU eşleşmesi (sku_master) → iwasku → matched FNSKU map
    const fnskuByIwasku = new Map<string, string>();
    if (query && query.length >= 2) {
      try {
        const rows = (await queryProductDb(
          `SELECT iwasku, fnsku FROM sku_master
           WHERE fnsku IS NOT NULL AND fnsku ILIKE $1
           ORDER BY iwasku, fnsku
           LIMIT 200`,
          [`%${query}%`]
        )) as Array<{ iwasku: string; fnsku: string }>;
        for (const r of rows) {
          if (!fnskuByIwasku.has(r.iwasku)) fnskuByIwasku.set(r.iwasku, r.fnsku);
        }
      } catch {
        // sku_master erişimi yoksa FNSKU araması sessizce atlanır
      }
    }
    const fnskuMatchIwaskus = [...fnskuByIwasku.keys()];

    // Dinamik WHERE ve params
    const conditions: string[] = [];
    const params: (string | null)[] = [];
    if (query && query.length >= 2) {
      const pat = `%${query}%`;
      params.push(pat, pat);
      const textCond = `(product_sku ILIKE $${params.length - 1} OR name ILIKE $${params.length})`;
      if (fnskuMatchIwaskus.length > 0) {
        const placeholders = fnskuMatchIwaskus
          .map((iw) => {
            params.push(iw);
            return `$${params.length}`;
          })
          .join(',');
        conditions.push(`(${textCond} OR product_sku IN (${placeholders}))`);
      } else {
        conditions.push(textCond);
      }
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const products = (await queryProductDb(
      `
      SELECT
        product_sku as iwasku,
        name,
        category,
        size,
        width, height, length, weight
      FROM products
      ${whereSql}
      ORDER BY name
      LIMIT 50
    `,
      params
    )) as Array<{ iwasku: string; name: string | null; category: string | null; size: string | null; width: unknown; height: unknown; length: unknown; weight: unknown }>;

    const num = (v: unknown): number | null => (v == null ? null : Number(v));
    const enriched = products.map((p) => ({
      ...p,
      matchedFnsku: fnskuByIwasku.get(p.iwasku) ?? null,
      // Katalog ölçüleri (ham birim: cm + kg) — kargo fiyat sorgu oto-doldurma için
      widthCm: num(p.width),
      heightCm: num(p.height),
      lengthCm: num(p.length),
      weightKg: num(p.weight),
    }));

    return successResponse(enriched);
  }
);
