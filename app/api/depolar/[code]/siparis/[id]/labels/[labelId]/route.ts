/**
 * DELETE /api/depolar/[code]/siparis/[id]/labels/[labelId]
 *   Etiketi sil (DB + dosya). Sadece MANAGER+.
 *
 * PATCH /api/depolar/[code]/siparis/[id]/labels/[labelId]
 *   { action: "print" } → printedAt + printedById set.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { deleteLabelFile } from '@/lib/wms/labelStorage';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

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

export const DELETE = withRoute<{ code: string; id: string; labelId: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Etiket silinemedi' },
  async ({ request, params }) => {
    const { code, id: orderId, labelId } = params;
    const loaded = await loadOrderAndLabel(code, orderId, labelId);
    if ('error' in loaded && loaded.error) return loaded.error;

    const auth = await requireShelfAction(request, loaded.upperCode, 'deleteLabel');
    if (auth instanceof NextResponse) return auth;

    await prisma.orderLabel.delete({ where: { id: labelId } });
    await deleteLabelFile(loaded.label.storagePath);

    return NextResponse.json({ success: true });
  }
);

export const PATCH = withRoute<{ code: string; id: string; labelId: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Etiket güncellenemedi' },
  async ({ request, params }) => {
    const { code, id: orderId, labelId } = params;
    const loaded = await loadOrderAndLabel(code, orderId, labelId);
    if ('error' in loaded && loaded.error) return loaded.error;

    const body = await request.json().catch(() => ({}));

    if (body.action === 'print') {
      const auth = await requireShelfAction(request, loaded.upperCode, 'printLabel');
      if (auth instanceof NextResponse) return auth;
      const updated = await prisma.orderLabel.update({
        where: { id: labelId },
        data: { printedAt: new Date(), printedById: auth.user.id },
        select: { id: true, printedAt: true },
      });
      return successResponse(updated);
    }

    if (body.action === 'updateTracking') {
      const auth = await requireShelfAction(request, loaded.upperCode, 'uploadLabel');
      if (auth instanceof NextResponse) return auth;
      const tn = typeof body.trackingNumber === 'string' ? body.trackingNumber.trim() : '';
      const updated = await prisma.orderLabel.update({
        where: { id: labelId },
        data: { trackingNumber: tn.length > 0 ? tn : null },
        select: { id: true, trackingNumber: true },
      });
      return successResponse(updated);
    }

    return NextResponse.json({ success: false, error: 'Geçersiz aksiyon' }, { status: 400 });
  }
);
