/**
 * DELETE /api/depolar/[code]/siparis/[id]/labels/[labelId]
 *   Etiketi sil (DB + dosya). Sadece MANAGER+.
 *
 * PATCH /api/depolar/[code]/siparis/[id]/labels/[labelId]
 *   { action: "print" } → printedAt + printedById set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { deleteLabelFile } from '@/lib/wms/labelStorage';

async function loadOrderAndLabel(code: string, orderId: string, labelId: string) {
  const upperCode = code.toUpperCase();
  if (!ALL_WAREHOUSES.includes(upperCode as (typeof ALL_WAREHOUSES)[number])) {
    return { error: NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 }) };
  }

  const label = await prisma.orderLabel.findUnique({
    where: { id: labelId },
    include: { outboundOrder: { select: { id: true, warehouseCode: true } } },
  });
  if (!label || label.outboundOrderId !== orderId || label.outboundOrder.warehouseCode !== upperCode) {
    return { error: NextResponse.json({ success: false, error: 'Etiket bulunamadı' }, { status: 404 }) };
  }
  return { label, upperCode };
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string; labelId: string }> }
) {
  const { code, id: orderId, labelId } = await context.params;
  const loaded = await loadOrderAndLabel(code, orderId, labelId);
  if ('error' in loaded) return loaded.error;

  const auth = await requireShelfAction(request, loaded.upperCode, 'deleteLabel');
  if (auth instanceof NextResponse) return auth;

  await prisma.orderLabel.delete({ where: { id: labelId } });
  await deleteLabelFile(loaded.label.storagePath);

  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string; labelId: string }> }
) {
  const { code, id: orderId, labelId } = await context.params;
  const loaded = await loadOrderAndLabel(code, orderId, labelId);
  if ('error' in loaded) return loaded.error;

  const auth = await requireShelfAction(request, loaded.upperCode, 'printLabel');
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  if (body.action !== 'print') {
    return NextResponse.json({ success: false, error: 'Geçersiz aksiyon' }, { status: 400 });
  }

  const updated = await prisma.orderLabel.update({
    where: { id: labelId },
    data: { printedAt: new Date(), printedById: auth.user.id },
    select: { id: true, printedAt: true },
  });

  return NextResponse.json({ success: true, data: updated });
}
