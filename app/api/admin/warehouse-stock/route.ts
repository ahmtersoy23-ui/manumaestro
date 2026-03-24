/**
 * Warehouse Stock API
 * GET:    List stock entries for a month (with product details from pricelab_db)
 * POST:   Upsert a stock entry (initial or weekly)
 * DELETE: Remove a stock entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { queryProductDb } from '@/lib/db/prisma';
import { verifyAuth, checkStockPermission } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { errorResponse } from '@/lib/api/response';
import { z } from 'zod';

const StockEntrySchema = z.object({
  iwasku: z.string().min(1),
  quantity: z.number().int().min(0),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  weekLabel: z.string().nullable().optional(),
});

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

    const month = request.nextUrl.searchParams.get('month');
    if (!month) {
      return NextResponse.json({ success: false, error: 'month parametresi gerekli' }, { status: 400 });
    }

    // Get stock entries
    const entries = await prisma.warehouseStock.findMany({
      where: { month },
      orderBy: [{ iwasku: 'asc' }, { weekLabel: 'asc' }],
    });

    // Get unique iwaskus to fetch product details
    const iwaskus = [...new Set(entries.map(e => e.iwasku))];

    // Fetch product details from pricelab_db
    let productMap: Record<string, { name: string; category: string; desi: number | null }> = {};
    if (iwaskus.length > 0) {
      const placeholders = iwaskus.map((_, i) => `$${i + 1}`).join(',');
      const products = await queryProductDb(
        `SELECT product_sku, name, category, size FROM products WHERE product_sku IN (${placeholders})`,
        iwaskus
      );
      productMap = Object.fromEntries(
        products.map((p: { product_sku: string; name: string; category: string; size: number | null }) => [
          p.product_sku,
          { name: p.name, category: p.category, desi: p.size },
        ])
      );
    }

    // Merge entries with product details
    const data = entries.map(e => ({
      ...e,
      productName: productMap[e.iwasku]?.name || e.iwasku,
      productCategory: productMap[e.iwasku]?.category || '',
      desi: productMap[e.iwasku]?.desi || null,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, 'Stok verileri getirilemedi');
  }
}

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
    const validation = StockEntrySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { iwasku, quantity, month, weekLabel } = validation.data;
    const wl = weekLabel ?? null;

    // Prisma nullable composite unique: use findFirst + create/update
    const existing = await prisma.warehouseStock.findFirst({
      where: { iwasku, month, weekLabel: wl },
    });

    const entry = existing
      ? await prisma.warehouseStock.update({
          where: { id: existing.id },
          data: { quantity, enteredById: auth.user.id },
        })
      : await prisma.warehouseStock.create({
          data: { iwasku, quantity, month, weekLabel: wl, enteredById: auth.user.id },
        });

    await logAction({
      userId: auth.user.id,
      userName: auth.user.name,
      userEmail: auth.user.email,
      action: 'UPDATE_STOCK',
      entityType: 'WarehouseStock',
      entityId: entry.id,
      description: `Stok güncellendi: ${iwasku} → ${quantity} adet (${wl || 'başlangıç'})`,
      metadata: { iwasku, quantity, month, weekLabel: wl },
    });

    return NextResponse.json({ success: true, data: entry });
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
    const id = z.string().uuid().safeParse(body.id);
    if (!id.success) {
      return NextResponse.json({ success: false, error: 'Geçersiz id' }, { status: 400 });
    }

    await prisma.warehouseStock.delete({ where: { id: id.data } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, 'Stok kaydı silinemedi');
  }
}
