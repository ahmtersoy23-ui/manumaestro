/**
 * Send Items API
 * POST: Mark selected packed items as sent (set sentAt)
 *   - Karayolu/hava: seçili itemleri gönder (parti halinde)
 *   - Deniz: ?closeShipment=true ile tüm itemleri gönder + sevkiyatı kapat
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

const SendItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).optional(), // Karayolu/hava: seçili itemler
  closeShipment: z.boolean().optional(),          // Deniz: sevkiyatı kapat
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const body = await request.json();
  const validation = SendItemsSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ success: false, error: 'Dogrulama hatasi' }, { status: 400 });
  }

  const { itemIds, closeShipment } = validation.data;

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!shipment) {
    return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  }

  // izin kontrolu: closeShipment → closeShipment, aksi halde sendItems
  const action = closeShipment ? 'closeShipment' : 'sendItems';
  const authResult = await requireShipmentAction(request, shipment.destinationTab, action);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  const now = new Date();

  if (closeShipment) {
    // Deniz sevkiyatı kapama — tüm itemlere sentAt ata + status IN_TRANSIT
    const unsentItems = shipment.items.filter(i => !i.sentAt);

    await prisma.$transaction(async (tx) => {
      // sentAt ata
      if (unsentItems.length > 0) {
        await tx.shipmentItem.updateMany({
          where: { shipmentId: id, sentAt: null },
          data: { sentAt: now, packed: true },
        });
      }

      // Depo çıkışları (sadece henüz sentAt'ı olmayan itemler için)
      for (const item of unsentItems) {
        await tx.warehouseProduct.updateMany({
          where: { iwasku: item.iwasku },
          data: { cikis: { increment: item.quantity } },
        });
        if (item.reserveId) {
          await tx.stockReserve.update({
            where: { id: item.reserveId },
            data: { shippedQuantity: { increment: item.quantity }, status: 'SHIPPED' },
          });
        }
      }

      // Sevkiyat statusunu güncelle
      await tx.shipment.update({
        where: { id },
        data: { status: 'IN_TRANSIT', actualDate: now },
      });
    });

    await logAction({
      userId: user.id, userName: user.name, userEmail: user.email,
      action: 'ROUTE_TO_SHIPMENT', entityType: 'Shipment', entityId: id,
      description: `Sevkiyat kapatildi: ${shipment.name} (${unsentItems.length} yeni item gonderildi)`,
    });

    return NextResponse.json({ success: true, data: { sent: unsentItems.length, closed: true } });
  }

  // Karayolu/hava — seçili itemleri gönder
  if (!itemIds || itemIds.length === 0) {
    return NextResponse.json({ success: false, error: 'Gonderilecek item seciniz' }, { status: 400 });
  }

  const itemsToSend = shipment.items.filter(i => itemIds.includes(i.id) && i.packed && !i.sentAt);
  if (itemsToSend.length === 0) {
    return NextResponse.json({ success: false, error: 'Gonderilecek hazir item bulunamadi' }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    // sentAt ata
    await tx.shipmentItem.updateMany({
      where: { id: { in: itemsToSend.map(i => i.id) } },
      data: { sentAt: now },
    });

    // Depo çıkışları
    for (const item of itemsToSend) {
      await tx.warehouseProduct.updateMany({
        where: { iwasku: item.iwasku },
        data: { cikis: { increment: item.quantity } },
      });
      if (item.reserveId) {
        await tx.stockReserve.update({
          where: { id: item.reserveId },
          data: { shippedQuantity: { increment: item.quantity }, status: 'SHIPPED' },
        });
      }
    }
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'ROUTE_TO_SHIPMENT', entityType: 'Shipment', entityId: id,
    description: `${itemsToSend.length} item gonderildi: ${shipment.name}`,
  });

  return NextResponse.json({ success: true, data: { sent: itemsToSend.length } });
}
