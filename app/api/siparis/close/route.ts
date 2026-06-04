/**
 * POST /api/siparis/close  { orderIds: string[] }   (OutboundOrder uuid'leri)
 *
 * Süper-admin: kargolanmış (SHIPPED) WISERSELL_AUTO siparişleri Wisersell'de external-close ile kapatır.
 * tracking order_labels'tan, carrier tracking prefix'inden türetilir. Başarılıysa wisersellClosedAt set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireSuperAdmin } from '@/lib/auth/verify';
import { closeWisersellExternal } from '@/lib/wisersell/databridgeClient';
import { carrierIdFromTracking } from '@/lib/wisersell/carrierMap';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisClose');

const Schema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(200),
  /** carrier prefix'ten türetilemezse zorunlu fallback (UI operatöre sorar) */
  carrierIdOverride: z.number().int().positive().optional(),
});

interface CloseResult {
  orderId: string;
  ok: boolean;
  message?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { orderIds, carrierIdOverride } = parsed.data;

  const orders = await prisma.outboundOrder.findMany({
    where: { id: { in: orderIds }, source: 'WISERSELL_AUTO' },
    include: { labels: { where: { type: 'SHIPPING', archivedAt: null }, select: { trackingNumber: true }, take: 1 } },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));

  const results: CloseResult[] = [];
  for (const id of orderIds) {
    const o = byId.get(id);
    if (!o) { results.push({ orderId: id, ok: false, message: 'Sipariş bulunamadı (WISERSELL_AUTO değil?)' }); continue; }
    if (o.wisersellClosedAt) { results.push({ orderId: id, ok: true, message: 'Zaten kapatılmış' }); continue; }
    if (!o.wisersellOrderId) { results.push({ orderId: id, ok: false, message: 'wisersellOrderId yok' }); continue; }
    if (o.status !== 'SHIPPED') { results.push({ orderId: id, ok: false, message: `Henüz kargolanmadı (status ${o.status})` }); continue; }

    const tracking = o.labels[0]?.trackingNumber?.trim();
    if (!tracking) { results.push({ orderId: id, ok: false, message: 'Tracking yok (SHIPPING etiketi eksik)' }); continue; }

    const carrierId = carrierIdOverride ?? carrierIdFromTracking(tracking);
    if (!carrierId) { results.push({ orderId: id, ok: false, message: `Carrier tracking'den belirlenemedi (${tracking}) — carrierIdOverride gerekli` }); continue; }

    try {
      await closeWisersellExternal(o.wisersellOrderId, carrierId, tracking);
      await prisma.outboundOrder.update({ where: { id }, data: { wisersellClosedAt: new Date() } });
      results.push({ orderId: id, ok: true, message: `Kapatıldı (carrier ${carrierId})` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ orderId: id, ok: false, message: `external-close hata: ${msg.slice(0, 150)}` });
    }
  }

  const closed = results.filter((r) => r.ok && !/Zaten/.test(r.message ?? '')).length;
  logger.info(`close: ${closed}/${orderIds.length} kapatıldı`);
  return NextResponse.json({ success: true, results, closed });
}
