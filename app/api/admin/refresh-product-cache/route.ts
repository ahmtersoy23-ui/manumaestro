/**
 * Refresh Product Cache (admin-only)
 * production_requests'teki productName + productCategory cache'lerini
 * pricelab.products tablosundaki canlı değerlerle eşitler.
 *
 * Tek seferlik kullanım: katalog güncellendikten sonra eski Excel import'larındaki
 * bayat cache'leri toptan tazelemek için tetiklenir.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { errorResponse } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, ['admin']);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    // 1. Tüm benzersiz iwasku'ları al
    const distinct = await prisma.productionRequest.findMany({
      select: { iwasku: true },
      distinct: ['iwasku'],
    });
    const skus = distinct.map(d => d.iwasku);
    if (skus.length === 0) {
      return NextResponse.json({ success: true, updated: 0, scanned: 0 });
    }

    // 2. Pricelab'dan canonical name + category çek
    const placeholders = skus.map((_, i) => `$${i + 1}`).join(',');
    const products = await queryProductDb(
      `SELECT product_sku, name, category FROM products WHERE product_sku IN (${placeholders})`,
      skus
    );
    const productMap = new Map(
      products.map((p: { product_sku: string; name: string | null; category: string | null }) => [
        p.product_sku,
        { name: p.name, category: p.category },
      ])
    );

    // 3. Her iwasku için cache'i tazele (sadece değişenleri update et)
    let updated = 0;
    let unmatched = 0;
    for (const sku of skus) {
      const p = productMap.get(sku);
      if (!p || !p.name) {
        unmatched++;
        continue;
      }
      const result = await prisma.productionRequest.updateMany({
        where: {
          iwasku: sku,
          OR: [
            { productName: { not: p.name } },
            ...(p.category ? [{ productCategory: { not: p.category } }] : []),
          ],
        },
        data: {
          productName: p.name,
          ...(p.category ? { productCategory: p.category } : {}),
        },
      });
      updated += result.count;
    }

    await logAction({
      userId: user.id, userName: user.name, userEmail: user.email,
      action: 'BULK_UPLOAD', entityType: 'ProductionRequest', entityId: 'cache-refresh',
      description: `Ürün cache yenilendi: ${updated} kayıt güncellendi (${skus.length} iwasku tarandı, ${unmatched} eşleşmedi)`,
      metadata: { scanned: skus.length, updated, unmatched },
    });

    return NextResponse.json({
      success: true,
      scanned: skus.length,
      updated,
      unmatched,
    });
  } catch (error) {
    return errorResponse(error, 'Ürün cache yenilenemedi');
  }
}
