/**
 * POST /api/siparis/veeqo-label  { orderId, remoteShipmentId, rateId, requestToken }
 *
 * Operatörün seçtiği oranla Veeqo'dan etiketi SATIN ALIR (GERÇEK PARA), PDF'i
 * OutboundOrder'a SHIPPING etiketi olarak kaydeder, tracking'i yazar.
 *
 * is_amazon_order modunda Veeqo tracking'i otomatik Amazon Seller Central'a yazar +
 * siparişi "shipped" yapar → close akışında external-close gereksiz, sadece /close kalır.
 *
 * Idempotency: sipariş zaten SHIPPING+tracking'li etikete sahipse YENİ etiket ALMAZ
 * (çift ücret + çift barkod riski — "sipariş başına TEK etiket" prensibi).
 * Yetki: requireBoardManager.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireBoardManager } from '@/lib/auth/boardAuth';
import { bookVeeqoLabel } from '@/lib/veeqo/databridgeClient';
import { saveLabelFile, LabelStorageError } from '@/lib/wms/labelStorage';
import { createLogger } from '@/lib/logger';

const logger = createLogger('VeeqoLabel');

const Schema = z.object({
  orderId: z.string().uuid(),
  remoteShipmentId: z.string().min(3),
  rateId: z.string().min(3),
  requestToken: z.string().optional(),
  options: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireBoardManager(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { orderId, remoteShipmentId, rateId, requestToken, options } = parsed.data;

  const order = await prisma.outboundOrder.findUnique({
    where: { id: orderId },
    include: { labels: { where: { type: 'SHIPPING', archivedAt: null }, select: { id: true, trackingNumber: true }, take: 1 } },
  });
  if (!order) {
    return NextResponse.json({ success: false, error: 'Sipariş bulunamadı' }, { status: 404 });
  }
  // Idempotency: zaten etiket alınmış → çift satın almayı engelle (gerçek para)
  const existing = order.labels.find((l) => l.trackingNumber);
  if (existing) {
    return NextResponse.json(
      { success: false, error: `Bu siparişin zaten etiketi var (tracking: ${existing.trackingNumber}). Çift ücret önlendi.`, alreadyHasLabel: true, trackingNumber: existing.trackingNumber },
      { status: 409 },
    );
  }

  // 1) Etiketi satın al (GERÇEK PARA) — DataBridge book endpoint'i retry YAPMAZ
  let booked;
  try {
    booked = await bookVeeqoLabel({ remoteShipmentId, rateId, requestToken, labelFormat: 'PDF', options });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Veeqo booking hatası';
    logger.error(`book error: ${order.orderNumber}: ${msg}`);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }

  // 2) PDF'i diske + OrderLabel olarak kaydet
  const pdfBuffer = Buffer.from(booked.labelBase64, 'base64');
  let saved;
  try {
    saved = await saveLabelFile({
      outboundOrderId: orderId,
      fileBuffer: pdfBuffer,
      fileName: `veeqo-${booked.trackingNumber}.pdf`,
      mimeType: 'application/pdf',
    });
  } catch (err) {
    // Etiket SATIN ALINDI ama dosya kaydedilemedi — tracking'i kaybetme, label'ı yine de yaz
    const ioMsg = err instanceof LabelStorageError ? err.message : (err as Error).message;
    logger.error(`label saved-to-disk FAILED ama booking OLDU (tracking ${booked.trackingNumber}): ${ioMsg}`);
    return NextResponse.json(
      { success: false, error: `Etiket alındı (tracking ${booked.trackingNumber}) ama dosya kaydedilemedi: ${ioMsg}. Veeqo'dan manuel indirin.`, trackingNumber: booked.trackingNumber, bookedButNotSaved: true },
      { status: 500 },
    );
  }

  const label = await prisma.orderLabel.create({
    data: {
      id: saved.id,
      outboundOrderId: orderId,
      type: 'SHIPPING',
      fileName: `veeqo-${booked.trackingNumber}.pdf`,
      storagePath: saved.storagePath,
      mimeType: 'application/pdf',
      fileSize: saved.fileSize,
      uploadedById: auth.user.id,
      trackingNumber: booked.trackingNumber,
      veeqoShipmentId: booked.shipmentId, // iade/iptal anahtarı (DELETE .../shipments/{id})
      // Bedel DB'ye yazılır (mutabakat/export) — etikete/damgaya BASILMAZ (PDF müşteriye gider).
      cost: booked.totalCharge?.value ?? null,
      costCurrency: booked.totalCharge?.unit ?? null,
      notes: `Veeqo: ${booked.serviceName ?? ''}`.trim(),
    },
  });

  logger.info(`label OK: ${order.orderNumber} tracking=${booked.trackingNumber} service=${booked.serviceName}`);
  return NextResponse.json({
    success: true,
    labelId: label.id,
    trackingNumber: booked.trackingNumber,
    serviceName: booked.serviceName,
    serviceCarrier: booked.serviceCarrier,
    totalCharge: booked.totalCharge,
  });
}
