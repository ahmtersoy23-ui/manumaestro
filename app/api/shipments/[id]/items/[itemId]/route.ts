/**
 * Shipment Item API
 * PATCH: Toggle packed status (depo elemanı hazırladı/paketledi)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;

  const { id, itemId } = await params;

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
