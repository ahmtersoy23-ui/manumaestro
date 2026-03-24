/**
 * Warehouse Stock Bulk Import API
 * POST: Import products with eskiStok from Excel/CSV
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { queryProductDb } from '@/lib/db/prisma';
import { verifyAuth, checkStockPermission } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { errorResponse } from '@/lib/api/response';
import { z } from 'zod';

const BulkStockSchema = z.object({
  items: z.array(z.object({
    iwasku: z.string().min(1),
    quantity: z.number().int().min(0),
  })).min(1).max(1000),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 });
    }

    const permCheck = await checkStockPermission(auth.user.id, auth.user.role, 'edit');
    if (!permCheck.allowed) {
      return NextResponse.json({ success: false, error: permCheck.reason }, { status: 403 });
    }

    const body = await request.json();
    const validation = BulkStockSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { items } = validation.data;

    // Validate iwaskus against pricelab_db
    const iwaskus = items.map(i => i.iwasku);
    const placeholders = iwaskus.map((_, i) => `$${i + 1}`).join(',');
    const products = await queryProductDb(
      `SELECT product_sku FROM products WHERE product_sku IN (${placeholders})`,
      iwaskus
    );
    const validSkus = new Set(products.map((p: { product_sku: string }) => p.product_sku));

    const warnings: string[] = [];
    let imported = 0;

    for (const item of items) {
      if (!validSkus.has(item.iwasku)) {
        warnings.push(`SKU bulunamadı: ${item.iwasku}`);
        continue;
      }

      await prisma.warehouseProduct.upsert({
        where: { iwasku: item.iwasku },
        update: { eskiStok: item.quantity },
        create: { iwasku: item.iwasku, eskiStok: item.quantity },
      });
      imported++;
    }

    await logAction({
      userId: auth.user.id,
      userName: auth.user.name,
      userEmail: auth.user.email,
      action: 'UPDATE_STOCK',
      entityType: 'WarehouseProduct',
      entityId: 'bulk',
      description: `Toplu stok import: ${imported} ürün, ${warnings.length} uyarı`,
      metadata: { imported, warnings: warnings.length },
    });

    return NextResponse.json({
      success: true,
      data: { imported, warnings },
    });
  } catch (error) {
    return errorResponse(error, 'Toplu stok import başarısız');
  }
}
