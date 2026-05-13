/**
 * GET  /api/depolar/[code]/sayim
 *   Cycle count task listesi (filtre: status).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { withRoute } from '@/lib/api/withRoute';

export const GET = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Sayım listesi alınamadı' },
  async ({ request, params }) => {
    const { code } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as (typeof ALL_WAREHOUSES)[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }

    const auth = await requireShelfAction(request, upperCode, 'view');
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');

    const where: { warehouseCode: string; status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISCREPANCY' } = {
      warehouseCode: upperCode,
    };
    if (statusFilter && ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY'].includes(statusFilter)) {
      where.status = statusFilter as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISCREPANCY';
    }

    const tasks = await prisma.cycleCountTask.findMany({
      where,
      orderBy: [{ status: 'asc' }, { scheduledFor: 'asc' }],
      take: 200,
      include: {
        shelf: { select: { code: true, shelfType: true } },
        _count: { select: { items: true } },
      },
    });

    const counts = await prisma.cycleCountTask.groupBy({
      by: ['status'],
      where: { warehouseCode: upperCode },
      _count: true,
    });

    return NextResponse.json({
      success: true,
      data: {
        role: auth.shelfRole,
        tasks: tasks.map((t) => ({
          id: t.id,
          shelfId: t.shelfId,
          shelfCode: t.shelf.code,
          shelfType: t.shelf.shelfType,
          abcClass: t.abcClass,
          status: t.status,
          scheduledFor: t.scheduledFor,
          toleranceQty: t.toleranceQty,
          startedAt: t.startedAt,
          completedAt: t.completedAt,
          itemCount: t._count.items,
        })),
        counts,
      },
    });
  }
);
