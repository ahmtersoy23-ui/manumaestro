/**
 * Unsend Items API
 * POST: Gönderilmiş item'ları geri al (sentAt = null, reserve geri)
 *   - PACKER ve MANAGER yapabilir
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

const UnsendSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const body = await request.json();
  const validation = UnsendSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ success: false, error: 'Dogrulama hatasi' }, { status: 400 });
  }

  const { itemIds } = validation.data;

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!shipment) {
    return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  }

  // PACKER veya MANAGER izni — unsendItems aksiyonu
  const authResult = await requireShipmentAction(request, shipment.destinationTab, 'unsendItems');
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  // Sadece sentAt !== null olan item'ları geri al
  const itemsToUnsend = shipment.items.filter(i => itemIds.includes(i.id) && i.sentAt);
  if (itemsToUnsend.length === 0) {
    return NextResponse.json({ success: false, error: 'Geri alinacak gonderilmis item bulunamadi' }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    // sentAt = null, packed durumunu koru
    await tx.shipmentItem.updateMany({
      where: { id: { in: itemsToUnsend.map(i => i.id) } },
      data: { sentAt: null },
    });

    // Reserve geri al
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
    description: `${itemsToUnsend.length} item gonderimi geri alindi: ${shipment.name}`,
  });

  return NextResponse.json({ success: true, data: { unsent: itemsToUnsend.length } });
}
