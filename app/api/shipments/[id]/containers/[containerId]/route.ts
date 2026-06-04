/**
 * Container sil — içindeki satırlar cascade silinir; etkilenen kalemlerin
 * packed durumu yeniden hesaplanır (yerleştirme geri alınır).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const DimSchema = z.object({
  width: z.number().positive().nullable().optional(),
  height: z.number().positive().nullable().optional(),
  depth: z.number().positive().nullable().optional(),
  weight: z.number().positive().nullable().optional(),
});

export const PATCH = withRoute<{ id: string; containerId: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Ölçü güncellenemedi' },
  async ({ request, params }) => {
    const { id, containerId } = params;
    const shipment = await prisma.shipment.findUnique({ where: { id } });
    if (!shipment) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadı' }, { status: 404 });

    const auth = await requireShipmentAction(request, shipment.destinationTab, 'manageBoxes');
    if (auth instanceof NextResponse) return auth;

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
    }
    const parsed = DimSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Geçersiz ölçü' }, { status: 400 });
    }

    const container = await prisma.shipmentContainer.findUnique({ where: { id: containerId } });
    if (!container || container.shipmentId !== id) {
      return NextResponse.json({ success: false, error: 'Konteyner bulunamadı' }, { status: 404 });
    }

    const updated = await prisma.shipmentContainer.update({
      where: { id: containerId },
      data: parsed.data,
    });
    return successResponse(updated);
  }
);

export const DELETE = withRoute<{ id: string; containerId: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Konteyner silinemedi' },
  async ({ request, params }) => {
    const { id, containerId } = params;
    const shipment = await prisma.shipment.findUnique({ where: { id } });
    if (!shipment) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadı' }, { status: 404 });

    const auth = await requireShipmentAction(request, shipment.destinationTab, 'manageBoxes');
    if (auth instanceof NextResponse) return auth;

    try {
      await prisma.$transaction(async (tx) => {
        const container = await tx.shipmentContainer.findUnique({
          where: { id: containerId },
          include: { lines: true },
        });
        if (!container || container.shipmentId !== id) throw new Error('Konteyner bulunamadı');

        const affectedItemIds = [...new Set(container.lines.map((l) => l.shipmentItemId))];
        await tx.shipmentContainer.delete({ where: { id: containerId } });

        // Etkilenen kalemlerin packed durumu (artık daha az yerleştirilmiş olabilir)
        for (const itemId of affectedItemIds) {
          const item = await tx.shipmentItem.findUnique({ where: { id: itemId } });
          if (!item) continue;
          const agg = await tx.shipmentContainerLine.aggregate({
            _sum: { quantity: true },
            where: { shipmentItemId: itemId, container: { shipmentId: id } },
          });
          const placed = agg._sum.quantity ?? 0;
          await tx.shipmentItem.update({ where: { id: itemId }, data: { packed: placed >= item.quantity } });
        }
      });
      return successResponse({ deleted: true });
    } catch (e) {
      return NextResponse.json(
        { success: false, error: e instanceof Error ? e.message : 'Konteyner silinemedi' },
        { status: 400 }
      );
    }
  }
);
