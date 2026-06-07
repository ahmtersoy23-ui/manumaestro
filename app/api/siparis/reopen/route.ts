/**
 * POST /api/siparis/reopen  { orderId: string }   (Manager+)
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
import { requireBoardManager } from '@/lib/auth/boardAuth';
import { reopenWisersellOrder } from '@/lib/wisersell/databridgeClient';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisReopen');

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

  // 1) Outbound DRAFT'ı sil (rezervasyon hesaplı → otomatik serbest; cascade items/labels)
  await prisma.outboundOrder.delete({ where: { id: orderId } });

  // 2) Wisersell'de "açık"a geri al (WISERSELL_AUTO + wisersellOrderId; best-effort)
  let wisersellReopened = false;
  let wisersellError: string | null = null;
  if (order.source === 'WISERSELL_AUTO' && order.wisersellOrderId) {
    try {
      await reopenWisersellOrder([order.wisersellOrderId]);
      wisersellReopened = true;
    } catch (err) {
      wisersellError = err instanceof Error ? err.message.slice(0, 160) : 'Wisersell reopen hatası';
    }
  }

  logger.info(`reopen: ${order.orderNumber} (#${order.wisersellOrderId ?? '-'}) silindi; Wisersell reopen=${wisersellReopened}${wisersellError ? ` (hata: ${wisersellError})` : ''} — ${auth.user.email}`);
  return NextResponse.json({ success: true, reopened: true, wisersellReopened, wisersellError });
}
