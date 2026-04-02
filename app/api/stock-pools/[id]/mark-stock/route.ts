/**
 * Stock Pool Mark-Stock API
 * POST: Mark existing depot free stock as season stock
 *
 * Body: { items: [{ iwasku, quantity }] }
 * For each item:
 *   - StockReserve.producedQuantity += quantity  (ATP increases)
 *   - StockReserve.targetQuantity  -= quantity   (remaining demand decreases)
 *   - StockReserve.status → STOCKED (if fully covered) or remains PLANNED
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';

const MarkStockSchema = z.object({
  items: z.array(z.object({
    iwasku: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  const { id } = await params;

  const pool = await prisma.stockPool.findUnique({
    where: { id },
    include: {
      reserves: {
        where: { status: { notIn: ['CANCELLED', 'SHIPPED'] } },
      },
    },
  });

  if (!pool) {
    return NextResponse.json({ success: false, error: 'Havuz bulunamadı' }, { status: 404 });
  }

  const body = await request.json();
  const validation = MarkStockSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { items } = validation.data;
  const reserveMap = new Map(pool.reserves.map(r => [r.iwasku, r]));

  const results: { iwasku: string; applied: number; skipped: boolean; reason?: string }[] = [];

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const reserve = reserveMap.get(item.iwasku);
      if (!reserve) {
        results.push({ iwasku: item.iwasku, applied: 0, skipped: true, reason: 'Havuzda bulunamadı' });
        continue;
      }

      // Can't apply more stock than remaining demand
      const maxApplicable = Math.max(0, reserve.targetQuantity - reserve.producedQuantity);
      const applyQty = Math.min(item.quantity, maxApplicable);

      if (applyQty <= 0) {
        results.push({ iwasku: item.iwasku, applied: 0, skipped: true, reason: 'Talep zaten karşılanmış' });
        continue;
      }

      const newProduced = reserve.producedQuantity + applyQty;
      const newTarget = reserve.targetQuantity - applyQty;
      const newStatus = newTarget <= 0 ? 'STOCKED' : reserve.status;

      // Keep desiPerUnit constant — recalculate targetDesi from new targetQuantity
      const desiPerUnit = reserve.targetDesi && reserve.targetQuantity > 0
        ? reserve.targetDesi / reserve.targetQuantity
        : null;
      const newTargetDesi = desiPerUnit !== null ? newTarget * desiPerUnit : undefined;

      await tx.stockReserve.update({
        where: { id: reserve.id },
        data: {
          producedQuantity: newProduced,
          targetQuantity: newTarget,
          status: newStatus as 'STOCKED' | 'PLANNED',
          ...(newTargetDesi !== undefined ? { targetDesi: newTargetDesi } : {}),
        },
      });

      results.push({ iwasku: item.iwasku, applied: applyQty, skipped: false });
    }
  });

  const applied = results.filter(r => !r.skipped).reduce((s, r) => s + r.applied, 0);
  const skipped = results.filter(r => r.skipped).length;

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'UPDATE_REQUEST', entityType: 'StockPool', entityId: id,
    description: `Depo stok eşleştirildi: ${results.filter(r => !r.skipped).length} ürün, ${applied} adet`,
    metadata: { results, applied, skipped },
  });

  return NextResponse.json({
    success: true,
    data: { results, applied, skipped },
  });
}
