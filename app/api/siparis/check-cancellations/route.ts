/**
 * POST /api/siparis/check-cancellations  (sunucu cron, x-internal-api-key)
 *
 * Wisersell'e iptali YANSIMAYAN Amazon siparişlerini yakalar: işlem-bekleyen
 * (DRAFT) Ama_US siparişlerinin Amazon durumunu SP-API'den canlı sorgular
 * (DataBridge üzerinden) ve 'Canceled' olanları `amazonCancelledAt` ile işaretler.
 * Board'da "İptal (Amazon)" rozeti + operatör onaylı "Listeden Düş".
 *
 * Kapsam: SADECE store 111 = Ama_US (Citi ayrı Amazon hesabı, kapsam dışı).
 * Pool yoklamasıyla aynı ritimde (15 dk) sunucu cron tetikler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAmazonOrderStatuses } from '@/lib/wisersell/databridgeClient';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisCancelCheck');

const SCOPE_MARKETPLACE = 'Ama_US';

export async function POST(request: NextRequest) {
  const key = request.headers.get('x-internal-api-key');
  if (!process.env.MANU_INTERNAL_API_KEY || key !== process.env.MANU_INTERNAL_API_KEY) {
    return NextResponse.json({ success: false, error: 'Yetkisiz' }, { status: 401 });
  }

  // İşlem-bekleyen (DRAFT, henüz sevk edilmemiş) Ama_US siparişleri — yakalanabilir.
  const drafts = await prisma.outboundOrder.findMany({
    where: { status: 'DRAFT', marketplaceCode: SCOPE_MARKETPLACE },
    select: { id: true, orderNumber: true, amazonCancelledAt: true },
  });
  if (!drafts.length) {
    return NextResponse.json({ success: true, checked: 0, canceled: 0 });
  }

  // orderNumber = Amazon Order ID (Ama_US siparişlerinde order_code).
  const orderNumbers = [...new Set(drafts.map((d) => d.orderNumber))];
  let statuses: Record<string, string>;
  try {
    statuses = await getAmazonOrderStatuses(orderNumbers);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`SP-API kontrol hatası: ${msg}`);
    return NextResponse.json({ success: false, error: 'SP-API kontrol başarısız' }, { status: 502 });
  }

  // Yeni iptal edilenler (daha önce işaretlenmemiş).
  const newlyCanceledIds = drafts
    .filter((d) => statuses[d.orderNumber] === 'Canceled' && !d.amazonCancelledAt)
    .map((d) => d.id);

  if (newlyCanceledIds.length) {
    await prisma.outboundOrder.updateMany({
      where: { id: { in: newlyCanceledIds } },
      data: { amazonCancelledAt: new Date() },
    });
    logger.info(`${newlyCanceledIds.length} Ama_US siparişi Amazon'da iptal işaretlendi (${drafts.length} kontrol edildi)`);
  }

  return NextResponse.json({ success: true, checked: drafts.length, canceled: newlyCanceledIds.length });
}
