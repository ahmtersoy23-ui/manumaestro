/**
 * Stock Pool Detail API
 * GET: Pool detail with reserves
 * PATCH: Update pool (status, notes)
 * DELETE: Delete pool (only if no produced stock)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { queryProductDb } from '@/lib/db/prisma';
import { logAction } from '@/lib/auditLog';
import { computeSezonProduced } from '@/lib/seasonal';
import { z } from 'zod';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const UpdatePoolSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(['ACTIVE', 'RELEASING', 'COMPLETED', 'CANCELLED']).optional(),
  targetShipDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export const GET = withRoute<{ id: string }>(
  { roles: ['admin', 'editor', 'viewer'], rateLimit: 'read', fallbackMessage: 'Havuz yüklenemedi' },
  async ({ params }) => {
    const { id } = params;

    const pool = await prisma.stockPool.findUnique({
      where: { id },
      include: {
        reserves: {
          include: {
            allocations: { orderBy: { month: 'asc' } },
          },
          orderBy: { targetQuantity: 'desc' },
        },
      },
    });

    if (!pool) {
      return NextResponse.json({ success: false, error: 'Havuz bulunamadı' }, { status: 404 });
    }

    // Enrich reserves with product names + canli desi from pricelab_db.
    // Cache (StockReserve.desiPerUnit) bayatlayabilir — UI'da pricelab.products'in
    // canli COALESCE(manual_size, size) degeri override eder. Allocator/üretim
    // hesaplarinin DB cache'i kullanmasi degismedi.
    const iwaskus = pool.reserves.map(r => r.iwasku);
    const productMap: Record<string, { name: string; desi: number | null }> = {};
    if (iwaskus.length > 0) {
      try {
        const ph = iwaskus.map((_, i) => `$${i + 1}`).join(',');
        const rows = await queryProductDb(
          `SELECT product_sku, name, COALESCE(manual_size, size) AS desi FROM products WHERE product_sku IN (${ph})`,
          iwaskus
        );
        for (const row of rows as { product_sku: string; name: string; desi: string | number | null }[]) {
          const desiNum = row.desi == null ? null : (typeof row.desi === 'number' ? row.desi : parseFloat(String(row.desi)));
          productMap[row.product_sku] = {
            name: row.name,
            desi: desiNum != null && Number.isFinite(desiNum) ? desiNum : null,
          };
        }
      } catch { /* continue without names */ }
    }

    // Sezon'a fiilen giden üretim her reserve için waterfall simülasyonu ile hesaplanır.
    // StockReserve.producedQuantity kolonu deprecated/hep 0 olduğundan burada türetilip
    // geri döndürülüyor — UI mevcut alan ismiyle okuyabilmek için override ediliyor.
    const sezonProduced = await computeSezonProduced(id);

    const enrichedReserves = pool.reserves.map(r => {
      const actualProduced = sezonProduced.byIwaskuQty.get(r.iwasku) ?? 0;
      const liveDesi = productMap[r.iwasku]?.desi ?? null;
      const effectiveDesi = liveDesi ?? r.desiPerUnit ?? null;
      return {
        ...r,
        productName: productMap[r.iwasku]?.name ?? null,
        producedQuantity: actualProduced,
        desiPerUnit: effectiveDesi,
        targetDesi: effectiveDesi != null ? r.targetQuantity * effectiveDesi : r.targetDesi,
        allocations: r.allocations.map(a => ({
          ...a,
          plannedDesi: effectiveDesi != null ? a.plannedQty * effectiveDesi : a.plannedDesi,
        })),
      };
    });

    // Pool toplamini canli desi ile yeniden hesapla
    const liveTotalDesi = enrichedReserves.reduce(
      (sum, r) => sum + (r.targetDesi ?? 0),
      0,
    );

    return successResponse({ ...pool, totalTargetDesi: liveTotalDesi, reserves: enrichedReserves });
  }
);

export const PATCH = withRoute<{ id: string }>(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Havuz güncellenemedi' },
  async ({ request, user, params }) => {
    const { id } = params;

    const body = await request.json();
    const validation = UpdatePoolSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const pool = await prisma.stockPool.findUnique({ where: { id } });
    if (!pool) {
      return NextResponse.json({ success: false, error: 'Havuz bulunamadı' }, { status: 404 });
    }

    const data = validation.data;
    const updated = await prisma.stockPool.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.targetShipDate !== undefined ? { targetShipDate: new Date(data.targetShipDate) } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });

    // If cancelled, cancel all reserves too
    if (data.status === 'CANCELLED') {
      await prisma.stockReserve.updateMany({
        where: { poolId: id, status: { notIn: ['SHIPPED', 'CANCELLED'] } },
        data: { status: 'CANCELLED' },
      });
    }

    await logAction({
      userId: user!.id, userName: user!.name, userEmail: user!.email,
      action: 'UPDATE_REQUEST', entityType: 'StockPool', entityId: id,
      description: `Havuz güncellendi: ${updated.name}`,
      metadata: { changes: data },
    });

    return successResponse(updated);
  }
);

export const DELETE = withRoute<{ id: string }>(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Havuz silinemedi' },
  async ({ user, params }) => {
    const { id } = params;

    const pool = await prisma.stockPool.findUnique({ where: { id } });

    if (!pool) {
      return NextResponse.json({ success: false, error: 'Havuz bulunamadı' }, { status: 404 });
    }

    // Delete cascade: reserves + allocations
    await prisma.stockPool.delete({ where: { id } });

    await logAction({
      userId: user!.id, userName: user!.name, userEmail: user!.email,
      action: 'DELETE_REQUEST', entityType: 'StockPool', entityId: id,
      description: `Havuz silindi: ${pool.name}`,
    });

    return NextResponse.json({ success: true });
  }
);
