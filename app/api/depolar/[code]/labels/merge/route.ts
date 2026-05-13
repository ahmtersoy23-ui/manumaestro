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
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { readLabelFile } from '@/lib/wms/labelStorage';
import { queryProductDb } from '@/lib/db/prisma';
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

    // "Çıkış bekleyen" = DRAFT && SHIPPING label var
    const orders = await prisma.outboundOrder.findMany({
      where: { warehouseCode: upperCode, status: 'DRAFT', orderType: 'SINGLE' },
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

    // FNSKU lookup (toplu)
    const allIwaskus = Array.from(
      new Set(eligible.flatMap((o) => o.items.map((i) => i.iwasku)))
    );
    const fnskuMap = new Map<string, string>();
    if (allIwaskus.length > 0) {
      try {
        // pg parametre olarak diziyi placeholder ile geçemediği için inline IN listesi
        // (iwasku alfanümerik + sınırlı karakter setinde — yine de defansif quote)
        const escaped = allIwaskus.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
        const rows = (await queryProductDb(
          `SELECT iwasku, fnsku FROM sku_master WHERE iwasku IN (${escaped}) AND fnsku IS NOT NULL`
        )) as Array<{ iwasku: string; fnsku: string }>;
        for (const r of rows) fnskuMap.set(r.iwasku, r.fnsku);
      } catch (e) {
        logger.warn('FNSKU lookup başarısız (devam edilir)', e);
      }
    }

    // Birleşik PDF
    const merged = await PDFDocument.create();
    const font = await merged.embedFont(StandardFonts.HelveticaBold);

    for (const order of eligible) {
      // Her order'ın HEPSİ shipping label'larını birleştir (genelde 1 tane ama
      // birden fazla yüklenmişse hepsi alınsın)
      for (const lbl of order.labels) {
        let srcBuf: Buffer;
        try {
          srcBuf = await readLabelFile(lbl.storagePath);
        } catch (e) {
          logger.error('Etiket dosyası okunamadı', { orderId: order.id, labelId: lbl.id, e });
          continue;
        }
        let srcPdf: PDFDocument;
        try {
          srcPdf = await PDFDocument.load(srcBuf, { ignoreEncryption: true });
        } catch (e) {
          logger.error('Etiket PDF parse hatası', { labelId: lbl.id, e });
          continue;
        }

        const pageIndices = srcPdf.getPageIndices();
        const copied = await merged.copyPages(srcPdf, pageIndices);
        for (const page of copied) {
          merged.addPage(page);

          // Footer overlay — sayfa altına ürün+sipariş bilgisi
          const { width } = page.getSize();
          const itemsLine = order.items
            .map((it) => {
              const fn = fnskuMap.get(it.iwasku);
              return `${it.iwasku} ×${it.quantity}${fn ? ` [${fn}]` : ''}`;
            })
            .join('  •  ');
          const line1 = `Siparis: ${order.orderNumber}  |  ${order.marketplaceCode}`;
          const line2 = itemsLine;

          // Beyaz şerit + metin
          const stripeH = 28;
          page.drawRectangle({
            x: 0,
            y: 0,
            width,
            height: stripeH,
            color: rgb(1, 1, 1),
            opacity: 0.92,
          });
          page.drawRectangle({
            x: 0,
            y: stripeH,
            width,
            height: 1,
            color: rgb(0.7, 0.7, 0.7),
          });
          page.drawText(line1, {
            x: 6,
            y: stripeH - 11,
            size: 8,
            font,
            color: rgb(0.1, 0.1, 0.1),
          });
          // Birden fazla item varsa truncate ile sığdır (font width ölçümü)
          const maxWidth = width - 12;
          let line2Render = line2;
          while (font.widthOfTextAtSize(line2Render, 7) > maxWidth && line2Render.length > 10) {
            line2Render = line2Render.slice(0, -4) + '…';
          }
          page.drawText(line2Render, {
            x: 6,
            y: 4,
            size: 7,
            font,
            color: rgb(0.2, 0.2, 0.2),
          });
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
