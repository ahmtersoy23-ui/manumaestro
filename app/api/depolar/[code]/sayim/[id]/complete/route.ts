/**
 * POST /api/depolar/[code]/sayim/[id]/complete
 *   Tüm kalemler sayılmış mı? Tolerance içinde mi?
 *     - Tüm diff <= tolerance → COMPLETED
 *     - En az 1 kalem diff > tolerance → DISCREPANCY (manager review)
 *   Sayılmamış kalem varsa hata.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as (typeof ALL_WAREHOUSES)[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'cycleCountPerform');
  if (auth instanceof NextResponse) return auth;

  const task = await prisma.cycleCountTask.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!task || task.warehouseCode !== upperCode) {
    return NextResponse.json({ success: false, error: 'Sayım bulunamadı' }, { status: 404 });
  }
  if (task.status !== 'IN_PROGRESS') {
    return NextResponse.json(
      { success: false, error: 'Sayım IN_PROGRESS değil' },
      { status: 400 }
    );
  }

  const uncounted = task.items.filter((i) => i.countedQty === null);
  if (uncounted.length > 0) {
    return NextResponse.json(
      { success: false, error: `${uncounted.length} kalem henüz sayılmadı` },
      { status: 400 }
    );
  }

  const hasDiscrepancy = task.items.some(
    (i) => Math.abs((i.countedQty ?? 0) - i.systemQty) > task.toleranceQty
  );

  await prisma.cycleCountTask.update({
    where: { id },
    data: {
      status: hasDiscrepancy ? 'DISCREPANCY' : 'COMPLETED',
      completedAt: new Date(),
      completedById: auth.user.id,
    },
  });

  return NextResponse.json({
    success: true,
    data: { status: hasDiscrepancy ? 'DISCREPANCY' : 'COMPLETED' },
  });
}
