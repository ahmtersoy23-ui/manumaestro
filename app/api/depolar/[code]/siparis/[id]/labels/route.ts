/**
 * POST /api/depolar/[code]/siparis/[id]/labels
 *   multipart/form-data: file + type (SHIPPING|FNSKU|OTHER) + opsiyonel shipmentBoxId + opsiyonel notes
 *
 * GET /api/depolar/[code]/siparis/[id]/labels
 *   Sipariş etiketlerini listele.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { saveLabelFile, LabelStorageError } from '@/lib/wms/labelStorage';

const VALID_TYPES = new Set(['SHIPPING', 'FNSKU', 'OTHER']);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id: orderId } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as (typeof ALL_WAREHOUSES)[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'uploadLabel');
  if (auth instanceof NextResponse) return auth;

  const order = await prisma.outboundOrder.findUnique({
    where: { id: orderId },
    select: { id: true, warehouseCode: true },
  });
  if (!order || order.warehouseCode !== upperCode) {
    return NextResponse.json({ success: false, error: 'Sipariş bulunamadı' }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz form data' }, { status: 400 });
  }

  const file = formData.get('file');
  const type = formData.get('type');
  const shipmentBoxId = formData.get('shipmentBoxId');
  const notes = formData.get('notes');

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'Dosya gerekli' }, { status: 400 });
  }
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { success: false, error: 'Etiket tipi geçersiz (SHIPPING|FNSKU|OTHER)' },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let saved;
  try {
    saved = await saveLabelFile({
      outboundOrderId: orderId,
      fileBuffer: buffer,
      fileName: file.name,
      mimeType: file.type,
    });
  } catch (err) {
    if (err instanceof LabelStorageError) {
      const status = err.code === 'TOO_LARGE' || err.code === 'INVALID_MIME' ? 400 : 500;
      return NextResponse.json({ success: false, error: err.message }, { status });
    }
    throw err;
  }

  const label = await prisma.orderLabel.create({
    data: {
      id: saved.id,
      outboundOrderId: orderId,
      shipmentBoxId: typeof shipmentBoxId === 'string' && shipmentBoxId.length > 0 ? shipmentBoxId : null,
      type: type as 'SHIPPING' | 'FNSKU' | 'OTHER',
      fileName: file.name,
      storagePath: saved.storagePath,
      mimeType: file.type,
      fileSize: saved.fileSize,
      uploadedById: auth.user.id,
      notes: typeof notes === 'string' && notes.length > 0 ? notes : null,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      id: label.id,
      type: label.type,
      fileName: label.fileName,
      fileSize: label.fileSize,
      mimeType: label.mimeType,
      uploadedAt: label.uploadedAt,
      printedAt: label.printedAt,
      shipmentBoxId: label.shipmentBoxId,
      notes: label.notes,
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id: orderId } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as (typeof ALL_WAREHOUSES)[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'view');
  if (auth instanceof NextResponse) return auth;

  const order = await prisma.outboundOrder.findUnique({
    where: { id: orderId },
    select: { id: true, warehouseCode: true },
  });
  if (!order || order.warehouseCode !== upperCode) {
    return NextResponse.json({ success: false, error: 'Sipariş bulunamadı' }, { status: 404 });
  }

  const labels = await prisma.orderLabel.findMany({
    where: { outboundOrderId: orderId },
    orderBy: [{ type: 'asc' }, { uploadedAt: 'desc' }],
    select: {
      id: true,
      type: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      uploadedAt: true,
      printedAt: true,
      shipmentBoxId: true,
      notes: true,
    },
  });

  return NextResponse.json({ success: true, data: labels, role: auth.shelfRole });
}
