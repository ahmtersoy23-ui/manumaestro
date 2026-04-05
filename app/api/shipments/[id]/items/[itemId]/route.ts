/**
 * Shipment Item API
 * PATCH: Toggle packed status
 * DELETE: Remove item from shipment (+ ilgili kolileri sil)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, itemId } = await params;
  const shipmentForAuth = await prisma.shipment.findUnique({ where: { id }, select: { destinationTab: true } });
  if (!shipmentForAuth) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  const authResult = await requireShipmentAction(request, shipmentForAuth.destinationTab, 'packItems');
  if (authResult instanceof NextResponse) return authResult;

  const item = await prisma.shipmentItem.findFirst({
    where: { id: itemId, shipmentId: id },
  });

  if (!item) {
    return NextResponse.json({ success: false, error: 'Item bulunamadi' }, { status: 404 });
  }

  const updated = await prisma.shipmentItem.update({
    where: { id: itemId },
    data: { packed: !item.packed },
  });

  return NextResponse.json({
    success: true,
    data: { id: updated.id, packed: updated.packed },
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, itemId } = await params;
  const shipmentForAuth = await prisma.shipment.findUnique({ where: { id }, select: { destinationTab: true } });
  if (!shipmentForAuth) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadi' }, { status: 404 });
  const authResult = await requireShipmentAction(request, shipmentForAuth.destinationTab, 'deleteItems');
  if (authResult instanceof NextResponse) return authResult;

  const item = await prisma.shipmentItem.findFirst({
    where: { id: itemId, shipmentId: id, sentAt: null },
  });

  if (!item) {
    return NextResponse.json({ success: false, error: 'Item bulunamadi veya zaten gonderilmis' }, { status: 404 });
  }

  // İlgili kolileri de sil
  await prisma.shipmentBox.deleteMany({ where: { shipmentItemId: itemId } });
  await prisma.shipmentItem.delete({ where: { id: itemId } });

  return NextResponse.json({ success: true });
}
