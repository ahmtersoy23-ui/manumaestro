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
import { getATPMap } from '@/lib/db/atp';
import { formatMonthValue } from '@/lib/monthUtils';
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

    // Get warehouse products with their weekly entries (capped at 5000 for safety)
    const products = await prisma.warehouseProduct.findMany({
      take: 5000,
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

    // Get ATP data (seasonal reserves)
    const atpMap = await getATPMap(iwaskus);

    // Get active seasonal pool info per iwasku (for toggle default)
    const activeReserves = await prisma.stockReserve.findMany({
      where: {
        iwasku: { in: iwaskus },
        status: { in: ['PLANNED', 'PRODUCING', 'STOCKED'] },
        pool: { poolType: 'SEASONAL', status: 'ACTIVE' },
      },
      select: {
        iwasku: true, targetQuantity: true, producedQuantity: true,
        pool: { select: { id: true, name: true } },
      },
    });
    const seasonPoolMap = new Map<string, { poolId: string; poolName: string; target: number; produced: number }>();
    for (const r of activeReserves) {
      seasonPoolMap.set(r.iwasku, {
        poolId: r.pool.id, poolName: r.pool.name,
        target: r.targetQuantity, produced: r.producedQuantity,
      });
    }

    // Get current month marketplace demands per iwasku
    const currentMonth = formatMonthValue(new Date());
    const monthDemands = iwaskus.length > 0
      ? await prisma.productionRequest.findMany({
          where: {
            productionMonth: currentMonth,
            iwasku: { in: iwaskus },
          },
          select: {
            iwasku: true,
            quantity: true,
            marketplace: { select: { code: true } },
          },
        })
      : [];

    // Build demand map: iwasku -> [{code, qty}]
    const demandMap = new Map<string, { code: string; qty: number }[]>();
    for (const d of monthDemands) {
      const list = demandMap.get(d.iwasku) ?? [];
      const existing = list.find(x => x.code === d.marketplace.code);
      if (existing) {
        existing.qty += d.quantity;
      } else {
        list.push({ code: d.marketplace.code, qty: d.quantity });
      }
      demandMap.set(d.iwasku, list);
    }

    // Enrich with product details and calculated fields
    const data = products.map(p => {
      const productionEntries = p.weeklyEntries.filter(w => w.type === 'PRODUCTION');
      const shipmentEntries = p.weeklyEntries.filter(w => w.type === 'SHIPMENT');
      const uretilen = productionEntries.reduce((sum, w) => sum + w.quantity, 0);
      const haftalikCikis = shipmentEntries.reduce((sum, w) => sum + w.quantity, 0);
      const toplamCikis = p.cikis + haftalikCikis;
      const mevcut = p.eskiStok + uretilen + p.ilaveStok - toplamCikis;
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
        haftalikCikis,
        toplamCikis,
        mevcut,
        reserved: atpMap.get(p.iwasku)?.reserved ?? 0,
        atp: atpMap.get(p.iwasku)?.atp ?? mevcut,
        _seasonPool: seasonPoolMap.get(p.iwasku) ?? null,
        _monthDemands: demandMap.get(p.iwasku) ?? [],
        toplamDesi: desi ? Math.round(mevcut * desi * 100) / 100 : null,
        weeklyEntries: productionEntries.map(w => ({
          id: w.id,
          weekStart: w.weekStart,
          quantity: w.quantity,
        })),
        shipmentEntries: shipmentEntries.map(w => ({
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

    // Get old value for audit log
    const existing = await prisma.warehouseProduct.findUnique({ where: { iwasku }, select: { eskiStok: true, ilaveStok: true, cikis: true } });
    const oldValue = existing ? existing[field as keyof typeof existing] : null;

    const product = await prisma.warehouseProduct.upsert({
      where: { iwasku },
      update: { [field]: value },
      create: { iwasku, [field]: value },
    });

    const fieldLabels: Record<string, string> = { eskiStok: 'Başlangıç Stoğu', ilaveStok: 'İlave', cikis: 'Çıkış' };
    await logAction({
      userId: auth.user.id,
      userName: auth.user.name,
      userEmail: auth.user.email,
      action: 'UPDATE_STOCK',
      entityType: 'WarehouseProduct',
      entityId: product.id,
      description: `${iwasku} — ${fieldLabels[field] || field}: ${oldValue ?? 0} → ${value}`,
      metadata: { iwasku, field, oldValue, newValue: value },
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
