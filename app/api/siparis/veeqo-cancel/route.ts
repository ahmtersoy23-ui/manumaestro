/**
 * POST /api/siparis/veeqo-cancel  { orderId }   (Manager+)
 *
 * Alınmış Veeqo etiketini İPTAL ET (iade). Veeqo'da void:
 *   DELETE /shipping/api/v1/shipments/{veeqoShipmentId} → 204 = Veeqo onayı.
 * Başarılıysa OrderLabel arşivlenir (archivedAt) → board'da SHIPPING etiketi düşer →
 * sipariş "Çıkış Bekliyor"dan "Etiket Bekliyor"a geri döner (tracking history kalır).
 *
 * NOT: 204 = Veeqo iptali kabul etti; fiili para iadesi kargo void döngüsüne bağlı
 * (anlık değil). Kargo taranmış/yola çıkmışsa Veeqo reddedebilir → hata operatöre döner.
 * Sipariş henüz SHIPPED olmamalı (DRAFT — etiket alındı ama depodan çıkış yapılmadı).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireBoardManager } from '@/lib/auth/boardAuth';
import { cancelVeeqoLabel } from '@/lib/veeqo/databridgeClient';
import { createLogger } from '@/lib/logger';

const logger = createLogger('VeeqoCancel');

export async function POST(request: NextRequest) {
  const auth = await requireBoardManager(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orderId: string | undefined = typeof body?.orderId === 'string' ? body.orderId : undefined;
  if (!orderId) {
    return NextResponse.json({ success: false, error: 'orderId gerekli' }, { status: 400 });
  }

  const order = await prisma.outboundOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, orderNumber: true, status: true,
      labels: { where: { type: 'SHIPPING', archivedAt: null }, select: { id: true, veeqoShipmentId: true, trackingNumber: true }, take: 1 },
    },
  });
  if (!order) {
    return NextResponse.json({ success: false, error: 'Sipariş bulunamadı' }, { status: 404 });
  }
  if (order.status !== 'DRAFT') {
    return NextResponse.json({ success: false, error: `Sevk edilmiş sipariş etiketi iptal edilemez (durum: ${order.status})` }, { status: 400 });
  }
  const label = order.labels[0];
  if (!label?.veeqoShipmentId) {
    return NextResponse.json({ success: false, error: 'Bu siparişte iptal edilebilir Veeqo etiketi yok' }, { status: 400 });
  }

  // 1) Veeqo'da iptal (void+iade). Hata = iptal edilemedi (örn. kargo taranmış) → operatöre.
  try {
    await cancelVeeqoLabel(label.veeqoShipmentId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Veeqo iptal hatası';
    logger.error(`cancel error: ${order.orderNumber} (sid ${label.veeqoShipmentId}): ${msg}`);
    return NextResponse.json({ success: false, error: `Veeqo etiketi iptal edilemedi: ${msg}` }, { status: 502 });
  }

  // 2) Veeqo onayladı → etiketi arşivle (board SHIPPING etiketini düşürür → Etiket Bekliyor'a döner)
  await prisma.orderLabel.update({ where: { id: label.id }, data: { archivedAt: new Date() } });

  logger.info(`cancel OK: ${order.orderNumber} tracking=${label.trackingNumber} → Veeqo void, etiket arşivlendi — ${auth.user.email}`);
  return NextResponse.json({ success: true, cancelled: true, trackingNumber: label.trackingNumber });
}
