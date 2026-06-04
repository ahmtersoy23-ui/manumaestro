/**
 * Container sil — içindeki satırlar cascade silinir; etkilenen kalemlerin
 * packed durumu yeniden hesaplanır (yerleştirme geri alınır).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

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
