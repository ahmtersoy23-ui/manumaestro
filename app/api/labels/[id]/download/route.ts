/**
 * GET /api/labels/[id]/download
 * Auth check (sipariş depo + view yetkisi) + dosya stream.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { readLabelFile, LabelStorageError } from '@/lib/wms/labelStorage';
import { stampLabelPdf, buildLabelCodes } from '@/lib/wms/labelStamp';
import { getProductsByIwasku } from '@/lib/products/lookup';
import { createLogger } from '@/lib/logger';
import { withRoute } from '@/lib/api/withRoute';

const logger = createLogger('LabelDownload');

// requireShelfAction depo-bazlı özel yetki — handler içinde tutuluyor.
export const GET = withRoute<{ id: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Etiket indirilemedi' },
  async ({ request, params }) => {
    const { id } = params;

    const label = await prisma.orderLabel.findUnique({
      where: { id },
      include: { outboundOrder: { select: { warehouseCode: true } } },
    });
    if (!label) {
      return NextResponse.json({ success: false, error: 'Etiket bulunamadı' }, { status: 404 });
    }
    if (label.archivedAt) {
      return NextResponse.json(
        { success: false, error: 'Bu etiket arşivlendi (dosya silindi). Sadece tracking number saklı.' },
        { status: 410 }
      );
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

    // SHIPPING PDF + siparişe bağlıysa: üste iwasku (+FNSKU) + not şeridi bas.
    let outBytes: Uint8Array = new Uint8Array(buffer);
    if (label.type === 'SHIPPING' && label.mimeType === 'application/pdf' && label.outboundOrderId) {
      try {
        const items = await prisma.outboundOrderItem.findMany({
          where: { outboundOrderId: label.outboundOrderId },
          select: { iwasku: true },
        });
        const productMap = await getProductsByIwasku(items.map((i) => i.iwasku));
        const codes = buildLabelCodes(
          items.map((i) => ({ iwasku: i.iwasku, fnsku: productMap.get(i.iwasku)?.fnsku ?? null }))
        );
        outBytes = await stampLabelPdf(buffer, { codes, note: label.notes });
      } catch (e) {
        logger.error('Etiket stamp başarısız — ham servis edilir', { labelId: id, e });
        outBytes = new Uint8Array(buffer);
      }
    }

    return new NextResponse(outBytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': label.mimeType,
        'Content-Length': String(outBytes.byteLength),
        'Content-Disposition': `inline; filename="${encodeURIComponent(label.fileName)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }
);
