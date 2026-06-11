/**
 * POST /api/siparis/cg-tracking  { orderId, tracking }
 *
 * CG (CastleGate) siparişine Wayfair MCF raporundan elle tracking girer (etiket YOK).
 * Kaydedildikten sonra "Wisersell'de Kapat" (external-close + platform-close) çalışabilir.
 * Yetki: Manager+.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrderBoardLevel } from '@/lib/auth/orderBoardPermission';
import { isWayfairChannel } from '@/lib/wisersell/orderRouting';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisCgTracking');

const Schema = z.object({
  orderId: z.string().uuid(),
  tracking: z.string().trim().min(3).max(200),
});

const CG_CODES = ['CG_SHUKRAN', 'CG_MDN'];

export async function POST(request: NextRequest) {
  const auth = await requireOrderBoardLevel(request, 'APPROVER');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { orderId, tracking } = parsed.data;

  const order = await prisma.outboundOrder.findUnique({ where: { id: orderId }, select: { warehouseCode: true, source: true, marketplaceCode: true } });
  // CG (CastleGate) VEYA Wayfair (dropship, US deposu) siparişleri elle tracking alır (Veeqo yok).
  // Auto (Wisersell) ve MANUAL (elle girilen) ikisi de geçerli.
  const eligible = !!order && (order.source === 'WISERSELL_AUTO' || order.source === 'MANUAL')
    && (CG_CODES.includes(order.warehouseCode) || isWayfairChannel(order.marketplaceCode));
  if (!eligible) {
    return NextResponse.json({ success: false, error: 'CG/Wayfair sipariş bulunamadı' }, { status: 404 });
  }

  // Virgüllü girişte ilkini sakla (Wayfair MCF birden çok koli tracking'i verebilir).
  const clean = tracking.split(',')[0].trim();
  await prisma.outboundOrder.update({ where: { id: orderId }, data: { manualTracking: clean } });
  logger.info(`cg-tracking: ${orderId} ← ${clean} (${auth.user.email})`);
  return NextResponse.json({ success: true, tracking: clean });
}
