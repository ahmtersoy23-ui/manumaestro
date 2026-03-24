/**
 * Warehouse Stock API (Redesigned)
 * GET:    List all products with stock data + weekly entries
 * POST:   Update a product's eskiStok, ilaveStok, or cikis
 * DELETE: Remove a product from warehouse
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { queryProductDb } from '@/lib/db/prisma';
import { verifyAuth, checkStockPermission } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { errorResponse } from '@/lib/api/response';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 });
    }

    const permCheck = await checkStockPermission(auth.user.id, auth.user.role, 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ success: false, error: permCheck.reason }, { status: 403 });
    }

    // Get all warehouse products with their weekly entries
    const products = await prisma.warehouseProduct.findMany({
      include: {
        weeklyEntries: {
          orderBy: { weekStart: 'asc' },
        },
      },
      orderBy: { iwasku: 'asc' },
    });

    // Fetch product details from pricelab_db
    const iwaskus = products.map(p => p.iwasku);
    let productMap: Record<string, { name: string; category: string; desi: number | null }> = {};

    if (iwaskus.length > 0) {
      const placeholders = iwaskus.map((_, i) => `$${i + 1}`).join(',');
      const details = await queryProductDb(
        `SELECT product_sku, name, category, COALESCE(manual_size, size) as size FROM products WHERE product_sku IN (${placeholders})`,
        iwaskus
      );
      productMap = Object.fromEntries(
        details.map((p: { product_sku: string; name: string; category: string; size: number | null }) => [
          p.product_sku,
          { name: p.name, category: p.category, desi: p.size },
        ])
      );
    }

    // Enrich with product details and calculated fields
    const data = products.map(p => {
      const uretilen = p.weeklyEntries.reduce((sum, w) => sum + w.quantity, 0);
      const mevcut = p.eskiStok + uretilen + p.ilaveStok - p.cikis;
      const info = productMap[p.iwasku];
      const desi = info?.desi || null;

      return {
        id: p.id,
        iwasku: p.iwasku,
        productName: info?.name || p.iwasku,
        productCategory: info?.category || '',
        desi,
        eskiStok: p.eskiStok,
        ilaveStok: p.ilaveStok,
        cikis: p.cikis,
        uretilen,
        mevcut,
        toplamDesi: desi ? Math.round(mevcut * desi * 100) / 100 : null,
        weeklyEntries: p.weeklyEntries.map(w => ({
          id: w.id,
          weekStart: w.weekStart,
          quantity: w.quantity,
        })),
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, 'Stok verileri getirilemedi');
  }
}

const UpdateProductSchema = z.object({
  iwasku: z.string().min(1),
  field: z.enum(['eskiStok', 'ilaveStok', 'cikis']),
  value: z.number().int(),
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
    const validation = UpdateProductSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { iwasku, field, value } = validation.data;

    const product = await prisma.warehouseProduct.upsert({
      where: { iwasku },
      update: { [field]: value },
      create: { iwasku, [field]: value },
    });

    await logAction({
      userId: auth.user.id,
      userName: auth.user.name,
      userEmail: auth.user.email,
      action: 'UPDATE_STOCK',
      entityType: 'WarehouseProduct',
      entityId: product.id,
      description: `Stok güncellendi: ${iwasku} → ${field}=${value}`,
      metadata: { iwasku, field, value },
    });

    return NextResponse.json({ success: true, data: product });
  } catch (error) {
    return errorResponse(error, 'Stok güncellenemedi');
  }
}

export async function DELETE(request: NextRequest) {
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
    const iwasku = z.string().min(1).safeParse(body.iwasku);
    if (!iwasku.success) {
      return NextResponse.json({ success: false, error: 'Geçersiz iwasku' }, { status: 400 });
    }

    await prisma.warehouseProduct.delete({ where: { iwasku: iwasku.data } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, 'Ürün silinemedi');
  }
}
