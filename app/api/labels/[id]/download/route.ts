/**
 * GET /api/labels/[id]/download
 * Auth check (sipariş depo + view yetkisi) + dosya stream.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { readLabelFile, LabelStorageError } from '@/lib/wms/labelStorage';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const label = await prisma.orderLabel.findUnique({
    where: { id },
    include: { outboundOrder: { select: { warehouseCode: true } } },
  });
  if (!label) {
    return NextResponse.json({ success: false, error: 'Etiket bulunamadı' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, label.outboundOrder.warehouseCode, 'view');
  if (auth instanceof NextResponse) return auth;

  let buffer: Buffer;
  try {
    buffer = await readLabelFile(label.storagePath);
  } catch (err) {
    if (err instanceof LabelStorageError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 410 });
    }
    throw err;
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': label.mimeType,
      'Content-Length': String(label.fileSize),
      'Content-Disposition': `inline; filename="${encodeURIComponent(label.fileName)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
