/**
 * POST /api/siparis/cancel  { orderIds: string[] }   (Manager+)
 *
 * "Listeden Düş" — Amazon'da iptal edilmiş (amazonCancelledAt) siparişleri
 * board'dan düşürür: DRAFT → CANCELLED. Rezervasyon hesaplandığı için
 * (getUsAvailability subtractPendingDraft) ayrıca serbest bırakma gerekmez.
 *
 * WISERSELL_AUTO + wisersellOrderId olan siparişlerde ek olarak Wisersell'e de
 * iptal itilir (best-effort, DataBridge cancel ucu). Sıra: önce yerel CANCELLED
 * (geri alınabilir), sonra dış iptal — dış başarısızsa yerel iptal yine de kalır.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrderBoardLevel } from '@/lib/auth/orderBoardPermission';
import { cancelWisersellOrder } from '@/lib/wisersell/databridgeClient';
import { logAction } from '@/lib/auditLog';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisCancel');

export async function POST(request: NextRequest) {
  const auth = await requireOrderBoardLevel(request, 'APPROVER');
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orderIds: string[] = Array.isArray(body?.orderIds)
    ? body.orderIds.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
    : [];
  if (!orderIds.length) {
    return NextResponse.json({ success: false, error: 'orderIds gerekli' }, { status: 400 });
  }

  // Sadece DRAFT iptal edilebilir (SHIPPED'e dokunma). Wisersell push için kaynak/id lazım.
  const targets = await prisma.outboundOrder.findMany({
    where: { id: { in: orderIds }, status: 'DRAFT' },
    select: { id: true, source: true, wisersellOrderId: true },
  });
  if (!targets.length) {
    return NextResponse.json({ success: true, cancelled: 0, wisersellCancelled: 0, wisersellFailed: [] });
  }

  // Split sevk: Amazon iptali sipariş seviyesi → bir parça iptal edilince TÜM kardeş
  // DRAFT alt-siparişler de iptal edilmeli (orphan kalmasın). Hedef wisersellOrderId'lerin
  // tüm DRAFT kardeşlerini yerel iptale dahil et; Wisersell iptali ID başına 1 kez.
  const wsIds = [...new Set(targets.filter((t) => t.source === 'WISERSELL_AUTO' && t.wisersellOrderId != null).map((t) => t.wisersellOrderId!))];
  const siblingIds = wsIds.length
    ? (await prisma.outboundOrder.findMany({ where: { wisersellOrderId: { in: wsIds }, status: 'DRAFT' }, select: { id: true } })).map((s) => s.id)
    : [];
  const allCancelIds = [...new Set([...targets.map((t) => t.id), ...siblingIds])];

  // 1) Yerel CANCELLED (rezervasyon hesaplı → otomatik serbest).
  await prisma.outboundOrder.updateMany({
    where: { id: { in: allCancelIds } },
    data: { status: 'CANCELLED' },
  });

  // 2) Wisersell'e iptal it (wisersellOrderId başına 1 kez; best-effort).
  let wisersellCancelled = 0;
  const wisersellFailed: string[] = [];
  for (const wsId of wsIds) {
    try {
      await cancelWisersellOrder(wsId);
      wisersellCancelled++;
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 120) : 'hata';
      wisersellFailed.push(`#${wsId}: ${msg}`);
    }
  }
  logger.info(`${allCancelIds.length} listeden düşürüldü (CANCELLED); Wisersell iptal ${wisersellCancelled}, başarısız ${wisersellFailed.length} — ${auth.user.email}`);
  await logAction({
    userId: auth.user.id, userName: auth.user.name, userEmail: auth.user.email,
    action: 'CANCEL_ORDER', entityType: 'OutboundOrder', entityId: allCancelIds.join(','),
    description: `${allCancelIds.length} sipariş listeden düşürüldü (CANCELLED)${wisersellCancelled ? `, Wisersell'de ${wisersellCancelled} iptal` : ''}`,
  });
  return NextResponse.json({ success: true, cancelled: allCancelIds.length, wisersellCancelled, wisersellFailed });
}
