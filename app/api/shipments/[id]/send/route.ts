/**
 * Send Items API
 * POST: Mark selected packed items as sent (set sentAt)
 *   - Karayolu/hava: seçili itemleri gönder (parti halinde, kısmi miktar destekli)
 *   - Deniz: ?closeShipment=true ile tüm itemleri gönder + sevkiyatı kapat
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { logAction } from '@/lib/auditLog';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const SendItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).optional(),       // Eski format (tam miktar)
  items: z.array(z.object({                              // Yeni format (kısmi miktar)
    id: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).optional(),
  closeShipment: z.boolean().optional(),
  reopenContainer: z.boolean().optional(),               // Konteyner: IN_TRANSIT → PLANNING geri al
});

export const POST = withRoute<{ id: string }>({ skipAuth: true, rateLimit: 'write', fallbackMessage: 'Gönderim başarısız' }, async ({ request, params }) => {
  const { id } = params;

  const body = await request.json();
  const validation = SendItemsSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ success: false, error: 'Dogrulama hatasi' }, { status: 400 });
  }

  const { itemIds, items, closeShipment, reopenContainer } = validation.data;

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!shipment) {
    return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  }

  // izin kontrolu: close/reopen → closeShipment, aksi halde sendItems
  const action = (closeShipment || reopenContainer) ? 'closeShipment' : 'sendItems';
  const authResult = await requireShipmentAction(request, shipment.destinationTab, action);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  const now = new Date();

  // Konteyner geri al: IN_TRANSIT → PLANNING, item.sentAt/packed temizle, KONTEYNER container'larını sil.
  // Sadece konteyner yöntemi için (yerel depo etkisi yok; reserve'siz item'lar).
  if (reopenContainer) {
    if (shipment.shippingMethod !== 'container') {
      return NextResponse.json({ success: false, error: 'Geri al yalnız konteyner sevkiyatında' }, { status: 400 });
    }
    await prisma.$transaction(async (tx) => {
      await tx.shipmentContainer.deleteMany({ where: { shipmentId: id, type: 'KONTEYNER' } });
      await tx.shipmentItem.updateMany({ where: { shipmentId: id }, data: { sentAt: null, packed: false } });
      await tx.shipment.update({ where: { id }, data: { status: 'PLANNING', actualDate: null } });
    });
    await logAction({
      userId: user.id, userName: user.name, userEmail: user.email,
      action: 'ROUTE_TO_SHIPMENT', entityType: 'Shipment', entityId: id,
      description: `Konteyner sevkiyatı geri alındı (PLANNING): ${shipment.name}`,
    });
    return successResponse({ reopened: true });
  }

  if (closeShipment) {
    // Deniz sevkiyatı kapama — tüm itemlere sentAt ata + status IN_TRANSIT + kolileri arşivle (atomik)
    const unsentItems = shipment.items.filter(i => !i.sentAt);

    const result = await prisma.$transaction(async (tx) => {
      if (unsentItems.length > 0) {
        await tx.shipmentItem.updateMany({
          where: { shipmentId: id, sentAt: null },
          data: { sentAt: now, packed: true },
        });
      }

      // Reserve güncelleme (depo çıkışı ayrı onay modalından yapılıyor)
      for (const item of unsentItems) {
        if (item.reserveId) {
          await tx.stockReserve.update({
            where: { id: item.reserveId },
            data: { shippedQuantity: { increment: item.quantity }, status: 'SHIPPED' },
          });
        }
      }

      await tx.shipment.update({
        where: { id },
        data: { status: 'IN_TRANSIT', actualDate: now },
      });

      // Konteyner yöntemi: koli iş akışı yok. Ürünleri (gönderilen item'lar) tek bir
      // KONTEYNER konteynerine yansıt → StockPulse cg_in_transit'i bu satırlardan sayar
      // (shipment_container_lines; ShipmentItem okunmaz). Idempotent: zaten KONTEYNER varsa
      // tekrar üretme.
      if (shipment.shippingMethod === 'container') {
        const existing = await tx.shipmentContainer.findFirst({
          where: { shipmentId: id, type: 'KONTEYNER' },
        });
        if (!existing) {
          const m = shipment.name.match(/\d+/);
          const prefix = m ? m[0] : shipment.name.split(/[\s-]/)[0];
          const container = await tx.shipmentContainer.create({
            data: { shipmentId: id, type: 'KONTEYNER', code: `${prefix}-C01` },
          });
          // unsentItems = bu kapatmada gönderilen kalemler (yukarıda sentAt aldılar)
          if (unsentItems.length > 0) {
            await tx.shipmentContainerLine.createMany({
              data: unsentItems.map(item => ({
                containerId: container.id,
                shipmentItemId: item.id,
                iwasku: item.iwasku,
                quantity: item.quantity,
              })),
            });
          }
        }
      }

      const boxes = await tx.shipmentBox.findMany({ where: { shipmentId: id } });
      if (boxes.length > 0) {
        await tx.shipmentBoxArchive.createMany({
          data: boxes.map(b => ({
            shipmentId: id,
            shipmentName: shipment.name,
            destinationTab: shipment.destinationTab,
            shippingMethod: shipment.shippingMethod,
            boxNumber: b.boxNumber,
            iwasku: b.iwasku,
            fnsku: b.fnsku,
            productName: b.productName,
            productCategory: b.productCategory,
            marketplaceCode: b.marketplaceCode,
            destination: b.destination,
            quantity: b.quantity,
            width: b.width,
            height: b.height,
            depth: b.depth,
            weight: b.weight,
            closedAt: now,
          })),
        });
      }

      return { sent: unsentItems.length, archived: boxes.length };
    });

    await logAction({
      userId: user.id, userName: user.name, userEmail: user.email,
      action: 'ROUTE_TO_SHIPMENT', entityType: 'Shipment', entityId: id,
      description: `Sevkiyat kapatıldı: ${shipment.name} (${result.sent} yeni item gönderildi, ${result.archived} koli arşivlendi)`,
    });

    return successResponse({ sent: result.sent, closed: true, archived: result.archived });
  }

  // Karayolu/hava — seçili itemleri gönder
  // Yeni format: items (kısmi miktar), eski format: itemIds (tam miktar)
  const sendMap = new Map<string, number>();
  if (items && items.length > 0) {
    for (const i of items) sendMap.set(i.id, i.quantity);
  } else if (itemIds && itemIds.length > 0) {
    for (const iid of itemIds) sendMap.set(iid, -1); // -1 = tam miktar
  } else {
    return NextResponse.json({ success: false, error: 'Gönderilecek item seçiniz' }, { status: 400 });
  }

  const itemsToSend = shipment.items.filter(i => sendMap.has(i.id) && i.packed && !i.sentAt);
  if (itemsToSend.length === 0) {
    return NextResponse.json({ success: false, error: 'Gönderilecek hazır item bulunamadı' }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    for (const item of itemsToSend) {
      const requestedQty = sendMap.get(item.id)!;
      const sendQty = requestedQty === -1 ? item.quantity : requestedQty;

      if (sendQty < item.quantity) {
        // Kısmi gönderim: kalan için yeni pending item oluştur
        const remaining = item.quantity - sendQty;
        await tx.shipmentItem.update({
          where: { id: item.id },
          data: { quantity: sendQty, sentAt: now },
        });
        await tx.shipmentItem.create({
          data: {
            shipmentId: id,
            iwasku: item.iwasku,
            quantity: remaining,
            desi: item.desi,
            marketplaceId: item.marketplaceId,
            reserveId: item.reserveId,
            packed: false,
          },
        });
      } else {
        // Tam veya fazla gönderim: miktarı güncelle
        await tx.shipmentItem.update({
          where: { id: item.id },
          data: { quantity: sendQty, sentAt: now },
        });
      }

      // Reserve güncelleme
      if (item.reserveId) {
        await tx.stockReserve.update({
          where: { id: item.reserveId },
          data: { shippedQuantity: { increment: sendQty }, status: 'SHIPPED' },
        });
      }
    }
  });

  const totalSent = itemsToSend.reduce((s, item) => {
    const rq = sendMap.get(item.id)!;
    return s + (rq === -1 ? item.quantity : rq);
  }, 0);

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'ROUTE_TO_SHIPMENT', entityType: 'Shipment', entityId: id,
    description: `${itemsToSend.length} item gönderildi (${totalSent} adet): ${shipment.name}`,
  });

  return successResponse({ sent: itemsToSend.length });
});
