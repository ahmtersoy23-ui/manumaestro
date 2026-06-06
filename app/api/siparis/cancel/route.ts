/**
 * POST /api/siparis/cancel  { orderIds: string[] }   (Manager+)
 *
 * "Listeden Düş" — Amazon'da iptal edilmiş (amazonCancelledAt) siparişleri
 * board'dan düşürür: DRAFT → CANCELLED. Rezervasyon hesaplandığı için
 * (getUsAvailability subtractPendingDraft) ayrıca serbest bırakma gerekmez.
 *
 * Not: Wisersell tarafına iptal itme AYRI adım (Part D) — burada sadece yerel
 * durum CANCELLED yapılır; CANCELLED board'da gösterilmez.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireBoardManager } from '@/lib/auth/boardAuth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisCancel');

export async function POST(request: NextRequest) {
  const auth = await requireBoardManager(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orderIds: string[] = Array.isArray(body?.orderIds)
    ? body.orderIds.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
    : [];
  if (!orderIds.length) {
    return NextResponse.json({ success: false, error: 'orderIds gerekli' }, { status: 400 });
  }

  // Sadece DRAFT iptal edilebilir (SHIPPED'e dokunma).
  const result = await prisma.outboundOrder.updateMany({
    where: { id: { in: orderIds }, status: 'DRAFT' },
    data: { status: 'CANCELLED' },
  });
  logger.info(`${result.count} sipariş listeden düşürüldü (DRAFT→CANCELLED) — ${auth.user.email}`);
  return NextResponse.json({ success: true, cancelled: result.count });
}
