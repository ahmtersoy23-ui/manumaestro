/**
 * POST /api/depolar/[code]/labels/bulk
 *
 * Tek PDF yüklenir, her sayfasını ayrı bir siparişe etiket olarak kaydeder.
 *
 * multipart/form-data:
 *   file: PDF (10MB limit, sadece application/pdf)
 *   type: SHIPPING | FNSKU | OTHER (tüm sayfalar aynı tip)
 *   mapping: JSON string — [{ pageIndex: 0, orderId: "X", trackingNumber?: "..." }, ...]
 *
 * Davranış:
 *   - Tüm orderId'lerin warehouseCode = path code olmalı
 *   - pageIndex sınırlar içinde olmalı, duplicate yok
 *   - pdf-lib ile her sayfa ayrı PDF olarak split edilir
 *   - Her parça `saveLabelFile` ile diske + OrderLabel olarak DB'ye yazılır
 *   - Tek transaction değil — kısmi başarı durumu raporlanır (atomicity yok,
 *     siparişler bağımsız; hatalı sayfalar errors[] içinde döner)
 */

import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { saveLabelFile, LabelStorageError, validateLabelFile } from '@/lib/wms/labelStorage';
import { createLogger } from '@/lib/logger';

const logger = createLogger('BulkLabelUpload');
const VALID_TYPES = new Set(['SHIPPING', 'FNSKU', 'OTHER']);

interface MappingEntry {
  pageIndex: number;
  orderId: string;
  trackingNumber?: string | null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as (typeof ALL_WAREHOUSES)[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'uploadLabel');
  if (auth instanceof NextResponse) return auth;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz form data' }, { status: 400 });
  }

  const file = formData.get('file');
  const type = formData.get('type');
  const mappingRaw = formData.get('mapping');

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'Dosya gerekli' }, { status: 400 });
  }
  if (file.type !== 'application/pdf') {
    return NextResponse.json(
      { success: false, error: 'Sadece PDF kabul edilir (toplu upload)' },
      { status: 400 }
    );
  }
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { success: false, error: 'Etiket tipi geçersiz' },
      { status: 400 }
    );
  }
  if (typeof mappingRaw !== 'string' || mappingRaw.length === 0) {
    return NextResponse.json({ success: false, error: 'Mapping gerekli' }, { status: 400 });
  }

  let mapping: MappingEntry[];
  try {
    mapping = JSON.parse(mappingRaw);
    if (!Array.isArray(mapping) || mapping.length === 0) throw new Error('boş');
  } catch {
    return NextResponse.json({ success: false, error: 'Mapping JSON geçersiz' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    validateLabelFile(file.type, buffer.length);
  } catch (err) {
    if (err instanceof LabelStorageError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    throw err;
  }

  // PDF'i parse et
  let sourceDoc: PDFDocument;
  try {
    sourceDoc = await PDFDocument.load(buffer);
  } catch (e) {
    logger.error('PDF parse', e);
    return NextResponse.json({ success: false, error: 'PDF okunamadı' }, { status: 400 });
  }
  const pageCount = sourceDoc.getPageCount();

  // Mapping doğrulama
  const seenIndexes = new Set<number>();
  for (const m of mapping) {
    if (typeof m.pageIndex !== 'number' || m.pageIndex < 0 || m.pageIndex >= pageCount) {
      return NextResponse.json(
        { success: false, error: `Geçersiz pageIndex: ${m.pageIndex} (PDF'de ${pageCount} sayfa)` },
        { status: 400 }
      );
    }
    if (seenIndexes.has(m.pageIndex)) {
      return NextResponse.json(
        { success: false, error: `Aynı sayfa birden fazla kez map'lendi: ${m.pageIndex}` },
        { status: 400 }
      );
    }
    seenIndexes.add(m.pageIndex);
    if (typeof m.orderId !== 'string' || m.orderId.length === 0) {
      return NextResponse.json({ success: false, error: 'orderId boş olamaz' }, { status: 400 });
    }
  }

  // Tüm orderId'leri lookup, warehouseCode kontrolü
  const orderIds = mapping.map((m) => m.orderId);
  const orders = await prisma.outboundOrder.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, warehouseCode: true, orderNumber: true },
  });
  const orderMap = new Map(orders.map((o) => [o.id, o]));
  for (const id of orderIds) {
    const o = orderMap.get(id);
    if (!o) {
      return NextResponse.json({ success: false, error: `Sipariş bulunamadı: ${id}` }, { status: 404 });
    }
    if (o.warehouseCode !== upperCode) {
      return NextResponse.json(
        { success: false, error: `Sipariş ${o.orderNumber} farklı depoda` },
        { status: 400 }
      );
    }
  }

  // Her sayfayı böl, kaydet
  const created: Array<{ orderId: string; labelId: string; pageIndex: number }> = [];
  const errors: Array<{ orderId: string; pageIndex: number; error: string }> = [];

  for (const m of mapping) {
    try {
      const pageDoc = await PDFDocument.create();
      const [copiedPage] = await pageDoc.copyPages(sourceDoc, [m.pageIndex]);
      pageDoc.addPage(copiedPage);
      const pageBytes = await pageDoc.save();
      const pageBuffer = Buffer.from(pageBytes);

      const baseName = file.name.replace(/\.pdf$/i, '');
      const pageFileName = `${baseName}-p${m.pageIndex + 1}.pdf`;

      const saved = await saveLabelFile({
        outboundOrderId: m.orderId,
        fileBuffer: pageBuffer,
        fileName: pageFileName,
        mimeType: 'application/pdf',
      });

      const label = await prisma.orderLabel.create({
        data: {
          id: saved.id,
          outboundOrderId: m.orderId,
          type: type as 'SHIPPING' | 'FNSKU' | 'OTHER',
          fileName: pageFileName,
          storagePath: saved.storagePath,
          mimeType: 'application/pdf',
          fileSize: saved.fileSize,
          uploadedById: auth.user.id,
          trackingNumber:
            typeof m.trackingNumber === 'string' && m.trackingNumber.length > 0
              ? m.trackingNumber
              : null,
        },
      });
      created.push({ orderId: m.orderId, labelId: label.id, pageIndex: m.pageIndex });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
      logger.error(`Bulk page ${m.pageIndex} → ${m.orderId}`, err);
      errors.push({ orderId: m.orderId, pageIndex: m.pageIndex, error: msg });
    }
  }

  return NextResponse.json({
    success: true,
    pageCount,
    createdCount: created.length,
    errorCount: errors.length,
    created,
    errors,
  });
}
