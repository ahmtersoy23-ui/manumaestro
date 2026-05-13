/**
 * PATCH /api/depolar/[code]/sayim/[id]/items/[itemId]
 *   Body:
 *     { action: "count", countedQty: number }   → blind sayım girişi (PACKER+)
 *     { action: "resolve", resolution: "ACCEPT|INVESTIGATE|IGNORE", notes? } → manager
 *
 *   ACCEPT seçilirse:
 *     - Sistem fiziksel quantity'i sayılan miktara çekilir (ShelfStock veya
 *       ShelfBox quantity = countedQty), reservedQty düşürülmez (manuel review)
 *     - ShelfMovement(ADJUSTMENT) yaratılır, refType=CYCLE_COUNT, refId=taskId
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { lockShelfBoxById, lockShelfStockById, assertNonNegative } from '@/lib/wms/lockedStock';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';
import type { Prisma } from '@prisma/client';

type LoadedItem = Prisma.CycleCountItemGetPayload<{ include: { task: true } }>;
type LoadResult =
  | { error: NextResponse; item?: undefined; upperCode?: undefined }
  | { error?: undefined; item: LoadedItem; upperCode: string };

async function loadItem(code: string, taskId: string, itemId: string): Promise<LoadResult> {
  const upperCode = code.toUpperCase();
  if (!ALL_WAREHOUSES.includes(upperCode as (typeof ALL_WAREHOUSES)[number])) {
    return { error: NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 }) };
  }
  const item = await prisma.cycleCountItem.findUnique({
    where: { id: itemId },
    include: { task: true },
  });
  if (!item || item.taskId !== taskId || item.task.warehouseCode !== upperCode) {
    return { error: NextResponse.json({ success: false, error: 'Kalem bulunamadı' }, { status: 404 }) };
  }
  return { item, upperCode };
}

export const PATCH = withRoute<{ code: string; id: string; itemId: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Sayım kalemi güncellenemedi' },
  async ({ request, params }) => {
    const { code, id: taskId, itemId } = params;
    const loaded = await loadItem(code, taskId, itemId);
    if (loaded.error) return loaded.error;
    const { item, upperCode } = loaded;

    const body = await request.json().catch(() => ({}));

    if (body.action === 'count') {
      const auth = await requireShelfAction(request, upperCode, 'cycleCountPerform');
      if (auth instanceof NextResponse) return auth;
      if (item.task.status !== 'IN_PROGRESS') {
        return NextResponse.json(
          { success: false, error: 'Sayım IN_PROGRESS değil' },
          { status: 400 }
        );
      }
      const counted = Number(body.countedQty);
      if (!Number.isFinite(counted) || counted < 0) {
        return NextResponse.json({ success: false, error: 'Geçersiz miktar' }, { status: 400 });
      }
      const updated = await prisma.cycleCountItem.update({
        where: { id: itemId },
        data: { countedQty: counted, diffQty: counted - item.systemQty },
        select: { id: true, countedQty: true, diffQty: true },
      });
      return successResponse(updated);
    }

    if (body.action === 'resolve') {
      const auth = await requireShelfAction(request, upperCode, 'cycleCountResolve');
      if (auth instanceof NextResponse) return auth;
      if (item.countedQty === null) {
        return NextResponse.json(
          { success: false, error: 'Bu kalem sayılmamış (countedQty yok)' },
          { status: 400 }
        );
      }
      const validRes = ['ACCEPT', 'INVESTIGATE', 'IGNORE'];
      if (!validRes.includes(body.resolution)) {
        return NextResponse.json(
          { success: false, error: 'Geçersiz resolution' },
          { status: 400 }
        );
      }

      const counted = item.countedQty;
      const diff = counted - item.systemQty;

      await prisma.$transaction(async (tx) => {
        // Resolution kaydı
        await tx.cycleCountItem.update({
          where: { id: itemId },
          data: {
            resolution: body.resolution,
            resolvedById: auth.user.id,
            resolvedAt: new Date(),
          },
        });

        // ACCEPT → fiziksel adjust (FOR UPDATE lock — concurrent OUTBOUND ile çakışmasın)
        if (body.resolution === 'ACCEPT' && diff !== 0) {
          if (item.source === 'STOCK' && item.shelfStockId) {
            const locked = await lockShelfStockById(tx, item.shelfStockId);
            if (!locked) throw new Error('Raf stoğu artık yok');
            // reservedQty değişmesin; counted < reserved ise inventory negatif rezerve olur — uyar
            assertNonNegative(`ShelfStock ${locked.iwasku} (counted - reserved)`, counted - locked.reservedQty);
            await tx.shelfStock.update({
              where: { id: locked.id },
              data: { quantity: counted },
            });
          }
          if (item.source === 'BOX' && item.shelfBoxId) {
            const locked = await lockShelfBoxById(tx, item.shelfBoxId);
            if (!locked) throw new Error('Koli artık yok');
            assertNonNegative(`ShelfBox ${locked.boxNumber} (counted - reserved)`, counted - locked.reservedQty);
            await tx.shelfBox.update({
              where: { id: locked.id },
              data: {
                quantity: counted,
                status: counted === 0 ? 'EMPTY' : undefined,
              },
            });
          }
          // Audit
          await tx.shelfMovement.create({
            data: {
              warehouseCode: upperCode,
              type: 'ADJUSTMENT',
              iwasku: item.iwasku,
              quantity: diff,
              shelfBoxId: item.source === 'BOX' ? item.shelfBoxId : null,
              toShelfId: item.task.shelfId,
              refType: 'CYCLE_COUNT',
              refId: item.taskId,
              userId: auth.user.id,
              notes:
                typeof body.notes === 'string' && body.notes.length > 0
                  ? body.notes
                  : `Cycle count: system=${item.systemQty} → counted=${counted}`,
            },
          });
        }
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Geçersiz aksiyon' }, { status: 400 });
  }
);
