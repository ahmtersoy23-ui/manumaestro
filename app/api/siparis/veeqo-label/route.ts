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
 * Yetki: sipariş board FULL (etiket = gerçek para).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrderBoardLevel } from '@/lib/auth/orderBoardPermission';
import { bookVeeqoLabel } from '@/lib/veeqo/databridgeClient';
import { saveLabelFile, LabelStorageError } from '@/lib/wms/labelStorage';
import { logAction } from '@/lib/auditLog';
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
  const auth = await requireOrderBoardLevel(request, 'FULL');
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
    booked = await bookVeeqoLabel({ remoteShipmentId, rateId, requestToken, labelFormat: 'PDF', options, orderNumber: order.orderNumber });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Veeqo booking hatası';
    logger.error(`book error: ${order.orderNumber}: ${msg}`);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }

  // Booking başarılı (para çekildi, tracking var) → PDF gelse de gelmese de denetime yaz.
  await logAction({
    userId: auth.user.id, userName: auth.user.name, userEmail: auth.user.email,
    action: 'LABEL_ORDER', entityType: 'OutboundOrder', entityId: orderId,
    description: `Veeqo etiketi alındı: ${order.orderNumber} · ${booked.serviceName ?? ''} · tracking ${booked.trackingNumber}`.trim(),
  });

  // 2) Etiketi kaydet. PDF geldiyse diske + OrderLabel. Gelmediyse (book OK ama getLabel başarısız —
  //    ör. Amazon Buy Shipping async) PDF'siz OrderLabel aç: booking KAYBOLMAZ → sipariş Çıkış
  //    Bekliyor'a düşer + tekrar-book engellenir (çift ücret imkânsız). PDF Amazon SC'den yazdırılır.
  if (booked.labelBase64) {
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
        veeqoShipmentId: booked.shipmentId,
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

  // PDF YOK: book başarılı (para çekildi) ama etiket Veeqo'dan alınamadı → kaybetme, kaydı yine aç.
  const label = await prisma.orderLabel.create({
    data: {
      outboundOrderId: orderId,
      type: 'SHIPPING',
      fileName: `veeqo-${booked.trackingNumber}-NOPDF`,
      storagePath: '', // PDF yok — Amazon Buy Shipping; Amazon SC'den yazdırılır (print bunu atlar)
      mimeType: 'application/pdf',
      fileSize: 0,
      uploadedById: auth.user.id,
      trackingNumber: booked.trackingNumber,
      veeqoShipmentId: booked.shipmentId,
      cost: booked.totalCharge?.value ?? null,
      costCurrency: booked.totalCharge?.unit ?? null,
      notes: `Veeqo: ${booked.serviceName ?? ''} — PDF alınamadı (Amazon Buy Shipping; Amazon SC'den yazdır)`.trim(),
    },
  });
  logger.warn(`label booked NO-PDF: ${order.orderNumber} tracking=${booked.trackingNumber} — kayıt açıldı (çift-book engellendi); sebep: ${booked.labelError ?? 'getLabel başarısız'}`);
  return NextResponse.json({
    success: true,
    labelId: label.id,
    trackingNumber: booked.trackingNumber,
    serviceName: booked.serviceName,
    totalCharge: booked.totalCharge,
    labelPending: true,
    message: 'Etiket alındı ve ücret çekildi, ancak PDF Veeqo\'dan gelmedi (Amazon Buy Shipping). Sipariş Çıkış Bekliyor\'a alındı; etiketi Amazon Seller Central\'dan yazdırın.',
  });
}
