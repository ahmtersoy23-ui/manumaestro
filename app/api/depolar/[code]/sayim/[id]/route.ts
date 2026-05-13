/**
 * GET /api/depolar/[code]/sayim/[id]
 *   Task detayı + raf konumları + items.
 *   Blind count: PENDING/IN_PROGRESS aşamasında countedQty===null olan
 *   item'ların systemQty'si dönmez (kullanıcıya gösterilmez). Manager
 *   COMPLETED/DISCREPANCY sonrası tüm değerleri görür.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getProductsByIwasku } from '@/lib/products/lookup';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute<{ code: string; id: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Sayım detayı alınamadı' },
  async ({ request, params }) => {
    const { code, id } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as (typeof ALL_WAREHOUSES)[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }

    const auth = await requireShelfAction(request, upperCode, 'view');
    if (auth instanceof NextResponse) return auth;

    const task = await prisma.cycleCountTask.findUnique({
      where: { id },
      include: {
        shelf: { select: { code: true, shelfType: true } },
        items: { orderBy: { iwasku: 'asc' } },
      },
    });

    if (!task || task.warehouseCode !== upperCode) {
      return NextResponse.json({ success: false, error: 'Sayım bulunamadı' }, { status: 404 });
    }

    const productMap = await getProductsByIwasku(task.items.map((i) => i.iwasku));

    // Blind görünüm: PENDING/IN_PROGRESS'te systemQty gizlenir
    const blind = task.status === 'PENDING' || task.status === 'IN_PROGRESS';
    // Yetki: cycleCountResolve olanlar tüm değerleri görür (audit + adjust için)
    const canSeeSystemQty = !blind || ['MANAGER', 'ADMIN'].includes(auth.shelfRole);

    return successResponse({
      role: auth.shelfRole,
      task: {
        id: task.id,
        shelfId: task.shelfId,
        shelfCode: task.shelf.code,
        shelfType: task.shelf.shelfType,
        abcClass: task.abcClass,
        status: task.status,
        scheduledFor: task.scheduledFor,
        toleranceQty: task.toleranceQty,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        notes: task.notes,
      },
      items: task.items.map((it) => ({
        id: it.id,
        iwasku: it.iwasku,
        productName: productMap.get(it.iwasku)?.name ?? null,
        source: it.source,
        shelfStockId: it.shelfStockId,
        shelfBoxId: it.shelfBoxId,
        systemQty: canSeeSystemQty ? it.systemQty : null,
        countedQty: it.countedQty,
        diffQty: blind && !canSeeSystemQty ? null : it.diffQty,
        resolution: it.resolution,
      })),
      blind,
    });
  }
);
