/**
 * Shipment Item API
 * PATCH: Toggle packed status
 * DELETE: Remove item from shipment (+ ilgili kolileri sil)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

type ItemParams = { id: string; itemId: string };

export const PATCH = withRoute<ItemParams>({ skipAuth: true, rateLimit: 'write', fallbackMessage: 'Item güncellenemedi' }, async ({ request, params }) => {
  const { id, itemId } = params;
  const shipmentForAuth = await prisma.shipment.findUnique({ where: { id }, select: { destinationTab: true } });
  if (!shipmentForAuth) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  const authResult = await requireShipmentAction(request, shipmentForAuth.destinationTab, 'packItems');
  if (authResult instanceof NextResponse) return authResult;

  const item = await prisma.shipmentItem.findFirst({ where: { id: itemId, shipmentId: id } });
  if (!item) return NextResponse.json({ success: false, error: 'Item bulunamadi' }, { status: 404 });

  const updated = await prisma.shipmentItem.update({
    where: { id: itemId },
    data: { packed: !item.packed },
  });

  return successResponse({ id: updated.id, packed: updated.packed });
});

export const DELETE = withRoute<ItemParams>({ skipAuth: true, rateLimit: 'write', fallbackMessage: 'Item silinemedi' }, async ({ request, params }) => {
  const { id, itemId } = params;
  const shipmentForAuth = await prisma.shipment.findUnique({ where: { id }, select: { destinationTab: true } });
  if (!shipmentForAuth) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  const authResult = await requireShipmentAction(request, shipmentForAuth.destinationTab, 'deleteItems');
  if (authResult instanceof NextResponse) return authResult;

  const item = await prisma.shipmentItem.findFirst({
    where: { id: itemId, shipmentId: id, sentAt: null },
  });
  if (!item) {
    return NextResponse.json({ success: false, error: 'Item bulunamadı veya zaten gönderilmiş' }, { status: 404 });
  }

  await prisma.shipmentBox.deleteMany({ where: { shipmentItemId: itemId } });
  await prisma.shipmentItem.delete({ where: { id: itemId } });

  return successResponse(null);
});
