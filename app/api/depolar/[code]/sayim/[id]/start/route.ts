/**
 * POST /api/depolar/[code]/sayim/[id]/start
 *   Task'ı IN_PROGRESS'e geçir + items'ı snapshot'la.
 *   ShelfStock + ShelfBox (status != EMPTY) kayıtlarından her satır için
 *   bir CycleCountItem yaratılır. systemQty = mevcut quantity (rezerve dahil
 *   tutulan toplam fiziksel sayı; cycle count fiziksel sayım, rezerve mantığı
 *   ayrı bir kayıt).
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
    select: { id: true, warehouseCode: true, shelfId: true, status: true },
  });
  if (!task || task.warehouseCode !== upperCode) {
    return NextResponse.json({ success: false, error: 'Sayım bulunamadı' }, { status: 404 });
  }
  if (task.status !== 'PENDING') {
    return NextResponse.json(
      { success: false, error: `Bu sayım zaten başlamış (durum: ${task.status})` },
      { status: 400 }
    );
  }

  // Mevcut raf içeriği — snapshot zamanı
  const [stocks, boxes] = await Promise.all([
    prisma.shelfStock.findMany({
      where: { shelfId: task.shelfId, quantity: { gt: 0 } },
      select: { id: true, iwasku: true, quantity: true },
    }),
    prisma.shelfBox.findMany({
      where: { shelfId: task.shelfId, status: { not: 'EMPTY' }, quantity: { gt: 0 } },
      select: { id: true, iwasku: true, quantity: true },
    }),
  ]);

  await prisma.$transaction(async (tx) => {
    await tx.cycleCountTask.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), startedById: auth.user.id },
    });

    if (stocks.length > 0) {
      await tx.cycleCountItem.createMany({
        data: stocks.map((s) => ({
          taskId: id,
          iwasku: s.iwasku,
          source: 'STOCK' as const,
          shelfStockId: s.id,
          systemQty: s.quantity,
        })),
      });
    }
    if (boxes.length > 0) {
      await tx.cycleCountItem.createMany({
        data: boxes.map((b) => ({
          taskId: id,
          iwasku: b.iwasku,
          source: 'BOX' as const,
          shelfBoxId: b.id,
          systemQty: b.quantity,
        })),
      });
    }
  });

  return NextResponse.json({
    success: true,
    data: { snapshotItems: stocks.length + boxes.length },
  });
}
