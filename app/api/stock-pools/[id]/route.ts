/**
 * Stock Pool Detail API
 * GET: Pool detail with reserves
 * PATCH: Update pool (status, notes)
 * DELETE: Delete pool (only if no produced stock)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';

const UpdatePoolSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(['ACTIVE', 'RELEASING', 'COMPLETED', 'CANCELLED']).optional(),
  targetShipDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

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

  return NextResponse.json({ success: true, data: pool });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  const { id } = await params;

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
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'UPDATE_REQUEST', entityType: 'StockPool', entityId: id,
    description: `Havuz güncellendi: ${updated.name}`,
    metadata: { changes: data },
  });

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  const { id } = await params;

  const pool = await prisma.stockPool.findUnique({
    where: { id },
    include: {
      reserves: { select: { producedQuantity: true } },
    },
  });

  if (!pool) {
    return NextResponse.json({ success: false, error: 'Havuz bulunamadı' }, { status: 404 });
  }

  const hasProduction = pool.reserves.some(r => r.producedQuantity > 0);
  if (hasProduction) {
    return NextResponse.json(
      { success: false, error: 'Üretimi başlamış havuz silinemez. İptal edin.' },
      { status: 400 }
    );
  }

  // Delete cascade: reserves + allocations
  await prisma.stockPool.delete({ where: { id } });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'DELETE_REQUEST', entityType: 'StockPool', entityId: id,
    description: `Havuz silindi: ${pool.name}`,
  });

  return NextResponse.json({ success: true });
}
