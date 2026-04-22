/**
 * Stock Reserve Line API
 * PATCH:  Update targetQuantity (line-by-line demand reduction)
 * DELETE: Remove reserve entirely (admin only, cascades allocations)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';

const UpdateReserveSchema = z.union([
  // Option A: explicit split → targetQuantity derived from sum
  z.object({
    marketplaceSplit: z.record(z.string(), z.number().int().min(0)),
  }),
  // Option B: direct total (legacy / fallback)
  z.object({
    targetQuantity: z.number().int().min(0),
  }),
]);

type Params = { params: Promise<{ id: string; reserveId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  // Reserve düzenleme admin-only: editor bir kez talep girdiğinde değiştiremez,
  // düzeltme gerekiyorsa admin üzerinden yapılmalı.
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  const { id, reserveId } = await params;

  const reserve = await prisma.stockReserve.findFirst({
    where: { id: reserveId, poolId: id },
  });

  if (!reserve) {
    return NextResponse.json({ success: false, error: 'Reserve bulunamadı' }, { status: 404 });
  }

  const body = await request.json();
  const validation = UpdateReserveSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const parsed = validation.data;
  let targetQuantity: number;
  let newSplit: Record<string, number> | undefined;

  if ('marketplaceSplit' in parsed) {
    newSplit = parsed.marketplaceSplit;
    targetQuantity = Object.values(newSplit).reduce((s, v) => s + v, 0);
  } else {
    targetQuantity = parsed.targetQuantity;
  }

  if (targetQuantity < reserve.producedQuantity) {
    return NextResponse.json(
      { success: false, error: `Üretilmiş miktarın (${reserve.producedQuantity}) altına düşürülemez` },
      { status: 400 }
    );
  }

  // Keep desiPerUnit constant — recalculate targetDesi from new targetQuantity
  const desiPerUnit = reserve.targetDesi && reserve.targetQuantity > 0
    ? reserve.targetDesi / reserve.targetQuantity
    : null;
  const newTargetDesi = desiPerUnit !== null ? targetQuantity * desiPerUnit : undefined;

  const updated = await prisma.stockReserve.update({
    where: { id: reserveId },
    data: {
      targetQuantity,
      ...(newSplit !== undefined ? { marketplaceSplit: newSplit } : {}),
      ...(newTargetDesi !== undefined ? { targetDesi: newTargetDesi } : {}),
    },
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'UPDATE_REQUEST', entityType: 'StockReserve', entityId: reserveId,
    description: `Talep güncellendi: ${reserve.iwasku} → ${reserve.targetQuantity} → ${targetQuantity}`,
    metadata: { iwasku: reserve.iwasku, oldQty: reserve.targetQuantity, newQty: targetQuantity, split: newSplit },
  });

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  const { id, reserveId } = await params;

  const reserve = await prisma.stockReserve.findFirst({
    where: { id: reserveId, poolId: id },
  });

  if (!reserve) {
    return NextResponse.json({ success: false, error: 'Reserve bulunamadı' }, { status: 404 });
  }

  // Cascade: allocations deleted automatically by Prisma (onDelete: Cascade in schema)
  await prisma.stockReserve.delete({ where: { id: reserveId } });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'DELETE_REQUEST', entityType: 'StockReserve', entityId: reserveId,
    description: `Reserve silindi: ${reserve.iwasku} (havuz: ${id})`,
    metadata: { iwasku: reserve.iwasku, targetQuantity: reserve.targetQuantity },
  });

  return NextResponse.json({ success: true });
}
