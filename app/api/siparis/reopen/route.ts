/**
 * POST /api/siparis/reopen  { orderId: string }   (sipariş board FULL)
 *
 * "Açık Siparişe Geri Al" — Veeqo fiyatı cazip değilse / başka sebeple, onaylı
 * (DRAFT, Etiket Bekliyor) bir siparişi tekrar "açık"a çevirir:
 *   1) Outbound DRAFT SİLİNİR (CANCELLED değil — candidate'ın Onay Bekliyor'a
 *      geri görünmesi için outbound kaydı kalmamalı). Rezervasyon hesaplı olduğundan
 *      (subtractPendingDraft) silme ile otomatik serbest kalır. Cascade: items/allocations/labels.
 *   2) WISERSELL_AUTO ise Wisersell'de "Kargoya Hazır" geri alınır → "açık" (open=2)
 *      + routing candidate gone_at temizlenir (poll beklemeden Onay Bekliyor'a döner).
 *
 * Guard: yalnız DRAFT + henüz etiket alınmamış (SHIPPING tracking yok). Etiket varsa
 * önce iade/iptal gerekir (çift ücret/kayıp etiket riski).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrderBoardLevel } from '@/lib/auth/orderBoardPermission';
import { reopenWisersellOrder, markWisersellOrderItems } from '@/lib/wisersell/databridgeClient';
import { logAction } from '@/lib/auditLog';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisReopen');

export async function POST(request: NextRequest) {
  const auth = await requireOrderBoardLevel(request, 'FULL');
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orderId: string | undefined = typeof body?.orderId === 'string' ? body.orderId : undefined;
  if (!orderId) {
    return NextResponse.json({ success: false, error: 'orderId gerekli' }, { status: 400 });
  }

  const order = await prisma.outboundOrder.findUnique({
    where: { id: orderId },
    include: { labels: { where: { type: 'SHIPPING', archivedAt: null }, select: { trackingNumber: true }, take: 1 } },
  });
  if (!order) {
    return NextResponse.json({ success: false, error: 'Sipariş bulunamadı' }, { status: 404 });
  }
  if (order.status !== 'DRAFT') {
    return NextResponse.json({ success: false, error: `Sadece DRAFT sipariş açığa alınabilir (mevcut: ${order.status})` }, { status: 400 });
  }
  if (order.labels.some((l) => l.trackingNumber)) {
    return NextResponse.json(
      { success: false, error: 'Bu siparişin etiketi var — önce etiketi iptal et (iade), sonra açığa al.', hasLabel: true },
      { status: 409 },
    );
  }

  // Split sevk: aynı wisersellOrderId'nin TÜM kardeş alt-siparişlerini birlikte aç (yarım
  // sipariş kalmasın). Tek/MANUAL siparişte siblings = [order].
  const isAuto = order.source === 'WISERSELL_AUTO' && order.wisersellOrderId != null;
  const siblings = isAuto
    ? await prisma.outboundOrder.findMany({
        where: { wisersellOrderId: order.wisersellOrderId, source: 'WISERSELL_AUTO' },
        include: { labels: { where: { type: 'SHIPPING', archivedAt: null }, select: { trackingNumber: true }, take: 1 } },
      })
    : [order];
  // Guard tüm kardeşlere: hepsi DRAFT + etiketsiz olmalı (biri kargolandıysa/etiketliyse blokla).
  const blocked = siblings.find((s) => s.status !== 'DRAFT' || s.labels.some((l) => l.trackingNumber));
  if (blocked && blocked.id !== orderId) {
    return NextResponse.json(
      { success: false, error: `Kardeş alt-sipariş (${blocked.warehouseCode}) açığa alınamaz (durum ${blocked.status}${blocked.labels.some((l) => l.trackingNumber) ? ', etiketli' : ''}) — önce onu çöz.` },
      { status: 409 },
    );
  }

  // 1) Tüm kardeş DRAFT'ları sil (rezervasyon hesaplı → otomatik serbest; cascade items/labels)
  await prisma.outboundOrder.deleteMany({ where: { id: { in: siblings.map((s) => s.id) } } });

  // 2) Wisersell'de "açık"a geri al (WISERSELL_AUTO + wisersellOrderId; best-effort) — sipariş seviyesi, 1 kez
  let wisersellReopened = false;
  let wisersellError: string | null = null;
  if (isAuto) {
    try {
      await reopenWisersellOrder([order.wisersellOrderId!]);
      wisersellReopened = true;
    } catch (err) {
      wisersellError = err instanceof Error ? err.message.slice(0, 160) : 'Wisersell reopen hatası';
    }
    // orderitem → Yeni (1): tüm kardeşlerin item id'leri (üretim kuyruğuna geri koy). Best-effort.
    const allItemIds = [...new Set(siblings.flatMap((s) => s.wisersellOrderItemIds))];
    if (allItemIds.length) {
      try {
        await markWisersellOrderItems(allItemIds, 1);
      } catch (err) {
        logger.error(`orderitem Yeni yazılamadı (order ${order.wisersellOrderId}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  logger.info(`reopen: ${order.orderNumber} (#${order.wisersellOrderId ?? '-'}) silindi; Wisersell reopen=${wisersellReopened}${wisersellError ? ` (hata: ${wisersellError})` : ''} — ${auth.user.email}`);
  await logAction({
    userId: auth.user.id, userName: auth.user.name, userEmail: auth.user.email,
    action: 'DELETE_ORDER', entityType: 'OutboundOrder', entityId: orderId,
    description: order.source === 'MANUAL'
      ? `Manuel sipariş silindi: ${order.orderNumber} (${order.warehouseCode})`
      : `Sipariş açığa alındı (silindi): ${order.orderNumber} (#${order.wisersellOrderId ?? '-'})${wisersellReopened ? ' · Wisersell açık' : ''}`,
  });
  return NextResponse.json({ success: true, reopened: true, wisersellReopened, wisersellError });
}
