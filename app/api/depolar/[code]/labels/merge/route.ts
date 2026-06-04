/**
 * GET /api/depolar/[code]/labels/merge?stage=cikis
 *
 * "Çıkış bekleyen" tüm DRAFT siparişlerin SHIPPING etiketlerini tek PDF'te
 * birleştirir. Her sayfanın altına overlay (footer) bilgi şeridi eklenir:
 *   "Sipariş: {orderNumber} | iwasku ×qty [FNSKU] | iwasku ×qty …"
 *
 * Eleman bu birleşik PDF'i basar; her etikette altta hangi ürünü hangi
 * raftan toplayacağı görünür.
 *
 * Response: PDF binary (application/pdf), filename header'da.
 *
 * NOT: printedAt set EDİLMEZ — kullanıcı PDF'i indirip bastığında ayrı bir
 * "yazdırıldı işaretle" aksiyonu yapmalı (ya tek tek LabelUploader'dan ya
 * da ileride toplu mark-printed endpoint'i ile).
 */

import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { readLabelFile } from '@/lib/wms/labelStorage';
import { stampLabelPdf, buildLabelCodes } from '@/lib/wms/labelStamp';
import { getProductsByIwasku } from '@/lib/products/lookup';
import { createLogger } from '@/lib/logger';
import { withRoute } from '@/lib/api/withRoute';

const logger = createLogger('LabelsMerge');

const SHELF_PRIMARY = new Set(['NJ', 'SHOWROOM']);

export const GET = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Etiket birleştirme başarısız' },
  async ({ request, params }) => {
    const { code } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }
    if (!SHELF_PRIMARY.has(upperCode)) {
      return NextResponse.json(
        { success: false, error: 'Sadece NJ ve SHOWROOM depolarında geçerli' },
        { status: 400 }
      );
    }

    const auth = await requireShelfAction(request, upperCode, 'printLabel');
    if (auth instanceof NextResponse) return auth;

    // Opsiyonel: belirli sipariş id'leri (Sipariş tab'ından seçili/depo-münhasır toplu yazdır).
    // Yoksa eski davranış: tüm "çıkış bekleyen" (DRAFT + SHIPPING label).
    const idsParam = new URL(request.url).searchParams.get('orderIds');
    const orderIdFilter = idsParam ? idsParam.split(',').map((s) => s.trim()).filter(Boolean) : null;

    // "Çıkış bekleyen" = DRAFT && SHIPPING label var
    const orders = await prisma.outboundOrder.findMany({
      where: {
        warehouseCode: upperCode, status: 'DRAFT', orderType: 'SINGLE',
        ...(orderIdFilter && orderIdFilter.length ? { id: { in: orderIdFilter } } : {}),
      },
      include: {
        items: true,
        labels: {
          where: { type: 'SHIPPING', archivedAt: null },
          orderBy: { uploadedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const eligible = orders.filter((o) => o.labels.length > 0);
    if (eligible.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Hazır SHIPPING etiketi olan çıkış bekleyen sipariş yok' },
        { status: 404 }
      );
    }

    // FNSKU (US) toplu çöz — kod satırı "iwasku (FNSKU)" için
    const allIwaskus = Array.from(
      new Set(eligible.flatMap((o) => o.items.map((i) => i.iwasku)))
    );
    const productMap = allIwaskus.length > 0 ? await getProductsByIwasku(allIwaskus) : new Map();

    // Birleşik PDF — her etiketin üstüne stamp (iwasku/FNSKU + not), 4×6 sabit
    const merged = await PDFDocument.create();

    for (const order of eligible) {
      const codes = buildLabelCodes(
        order.items.map((i) => ({ iwasku: i.iwasku, fnsku: productMap.get(i.iwasku)?.fnsku ?? null }))
      );
      for (const lbl of order.labels) {
        let srcBuf: Buffer;
        try {
          srcBuf = await readLabelFile(lbl.storagePath);
        } catch (e) {
          logger.error('Etiket dosyası okunamadı', { orderId: order.id, labelId: lbl.id, e });
          continue;
        }
        try {
          const stamped = await stampLabelPdf(srcBuf, { codes, note: lbl.notes });
          const stampedPdf = await PDFDocument.load(stamped);
          const copied = await merged.copyPages(stampedPdf, stampedPdf.getPageIndices());
          for (const page of copied) merged.addPage(page);
        } catch (e) {
          logger.error('Etiket stamp/birleştirme hatası', { labelId: lbl.id, e });
          continue;
        }
      }
    }

    const bytes = await merged.save();
    // Binary PDF response — withRoute success wrapper'ı SKIP.
    return new NextResponse(bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="cikis-etiketleri-${upperCode}-${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    });
  }
);
