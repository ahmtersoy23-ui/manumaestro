/**
 * Warehouse Weekly Entry API
 * POST: Upsert a weekly production entry for a product
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyAuth, checkStockPermission } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { errorResponse } from '@/lib/api/response';
import { z } from 'zod';

const WeeklyEntrySchema = z.object({
  iwasku: z.string().min(1),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD (Monday)
  quantity: z.number().int().min(0),
  type: z.enum(['PRODUCTION', 'SHIPMENT']).default('PRODUCTION'),
  poolId: z.string().uuid().optional(), // Seasonal pool — if set, updates reserve.producedQuantity
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
    const validation = WeeklyEntrySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { iwasku, weekStart, quantity, type, poolId } = validation.data;
    const weekDate = new Date(weekStart);

    // Ensure product exists in warehouse
    await prisma.warehouseProduct.upsert({
      where: { iwasku },
      update: {},
      create: { iwasku },
    });

    // Upsert weekly entry (unique by iwasku + weekStart + type)
    const existing = await prisma.warehouseWeekly.findFirst({
      where: { iwasku, weekStart: weekDate, type },
    });

    let entry;
    if (quantity === 0 && existing) {
      await prisma.warehouseWeekly.delete({ where: { id: existing.id } });
      entry = null;
    } else if (quantity > 0) {
      if (existing) {
        entry = await prisma.warehouseWeekly.update({
          where: { id: existing.id },
          data: { quantity, enteredById: auth.user.id },
        });
      } else {
        entry = await prisma.warehouseWeekly.create({
          data: { iwasku, weekStart: weekDate, quantity, type, enteredById: auth.user.id },
        });
      }
    }

    // Season pool tracking: poolId is kept for UI display (mor/yeşil renk)
    // but producedQuantity is NOT auto-incremented here.
    // Season production is tracked via batch reconciliation (toptan uzlaştırma).
    // Weekly entries only affect warehouse mevcut — season accounting is separate.

    const oldQty = existing?.quantity ?? 0;
    const typeLabel = type === 'PRODUCTION' ? 'Üretim' : 'Çıkış';
    const poolLabel = poolId ? ' [SEZON]' : '';
    await logAction({
      userId: auth.user.id,
      userName: auth.user.name,
      userEmail: auth.user.email,
      action: 'UPDATE_STOCK',
      entityType: 'WarehouseWeekly',
      entityId: iwasku,
      description: `${iwasku} — ${typeLabel}${poolLabel} (${weekStart}): ${oldQty} → ${quantity}`,
      metadata: { iwasku, weekStart, type, oldQty, newQty: quantity, poolId },
    });

    return NextResponse.json({ success: true, data: entry });
  } catch (error) {
    return errorResponse(error, 'Haftalık giriş güncellenemedi');
  }
}
