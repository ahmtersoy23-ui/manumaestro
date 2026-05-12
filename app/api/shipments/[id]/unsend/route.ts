/**
 * Unsend Items API
 * POST: Gönderilmiş item'ları geri al (sentAt = null, reserve geri)
 *   - PACKER ve MANAGER yapabilir
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { logAction } from '@/lib/auditLog';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const UnsendSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(500),
});

export const POST = withRoute<{ id: string }>({ skipAuth: true, rateLimit: 'write', fallbackMessage: 'Geri alma başarısız' }, async ({ request, params }) => {
  const { id } = params;

  const body = await request.json();
  const validation = UnsendSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ success: false, error: 'Doğrulama hatası' }, { status: 400 });
  }

  const { itemIds } = validation.data;

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!shipment) {
    return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  }

  const authResult = await requireShipmentAction(request, shipment.destinationTab, 'unsendItems');
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  const itemsToUnsend = shipment.items.filter(i => itemIds.includes(i.id) && i.sentAt);
  if (itemsToUnsend.length === 0) {
    return NextResponse.json({ success: false, error: 'Geri alınacak gönderilmiş item bulunamadı' }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipmentItem.updateMany({
      where: { id: { in: itemsToUnsend.map(i => i.id) } },
      data: { sentAt: null },
    });

    for (const item of itemsToUnsend) {
      if (item.reserveId) {
        const reserve = await tx.stockReserve.findUnique({ where: { id: item.reserveId } });
        if (reserve && reserve.shippedQuantity >= item.quantity) {
          await tx.stockReserve.update({
            where: { id: item.reserveId },
            data: {
              shippedQuantity: { decrement: item.quantity },
              status: 'STOCKED',
            },
          });
        }
      }
    }
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'ROUTE_TO_SHIPMENT', entityType: 'Shipment', entityId: id,
    description: `${itemsToUnsend.length} item gönderimi geri alındı: ${shipment.name}`,
  });

  return successResponse({ unsent: itemsToUnsend.length });
});
