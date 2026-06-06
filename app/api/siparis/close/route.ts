/**
 * POST /api/siparis/close  { orderIds: string[] }   (OutboundOrder uuid'leri)
 *
 * WISERSELL_AUTO siparişleri Wisersell'de kapatır. İki adım (memory: uniform akış):
 *   1) external-close (carrier + tracking) — tracking'i marketplace'e push'lar / harici kargo yazar.
 *   2) platform-close (GET /orders/{id}/close) — siparişi platformda "Açık"tan düşürür (evrensel son adım).
 *      external-close olmadan 404 verir; bu yüzden 1. adım zorunlu ön koşul.
 *
 * Tracking kaynağı:
 *   - Normal sipariş: SHIPPING etiketi (order_labels.trackingNumber), status SHIPPED olmalı.
 *   - CG (CastleGate, warehouseCode CG_*): etiket/shelf çıkışı YOK → tracking = manualTracking
 *     (operatör Wayfair MCF raporundan girer), status şartı yok. Kapanınca SHIPPED işaretlenir.
 *
 * Wisersell /close agresif rate-limit'li (429) → siparişler arası throttle + 429'da backoff.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireBoardManager } from '@/lib/auth/boardAuth';
import { closeWisersellExternal, closeWisersellPlatform } from '@/lib/wisersell/databridgeClient';
import { carrierIdFromTracking, WISERSELL_CARRIER_IDS } from '@/lib/wisersell/carrierMap';
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

const CG_CODES = ['CG_SHUKRAN', 'CG_MDN'];
const THROTTLE_MS = 8_000;      // siparişler arası bekleme (rate-limit'i yormamak için)
const BACKOFF_BASE_MS = 5_000;  // 429'da ilk backoff
const BACKOFF_MAX_MS = 20_000;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** platform-close'u 429 (rate-limit) durumunda exponential backoff ile tekrar dener. */
async function platformCloseWithBackoff(wisersellOrderId: number): Promise<void> {
  let attempt = 0;
  for (;;) {
    try {
      await closeWisersellPlatform(wisersellOrderId);
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = /\b429\b/.test(msg);
      if (!isRateLimit || attempt >= MAX_RETRIES) throw err;
      const wait = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
      logger.info(`platform-close 429 (order ${wisersellOrderId}), ${wait}ms backoff (deneme ${attempt + 1})`);
      await sleep(wait);
      attempt++;
    }
  }
}

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
  const { orderIds, carrierIdOverride } = parsed.data;

  const orders = await prisma.outboundOrder.findMany({
    where: { id: { in: orderIds }, source: 'WISERSELL_AUTO' },
    include: { labels: { where: { type: 'SHIPPING', archivedAt: null }, select: { trackingNumber: true }, take: 1 } },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));

  const results: CloseResult[] = [];
  let processed = 0; // gerçekten Wisersell'e gidilen sipariş sayısı (throttle için)

  for (const id of orderIds) {
    const o = byId.get(id);
    if (!o) { results.push({ orderId: id, ok: false, message: 'Sipariş bulunamadı (WISERSELL_AUTO değil?)' }); continue; }
    if (o.wisersellClosedAt) { results.push({ orderId: id, ok: true, message: 'Zaten kapatılmış' }); continue; }
    if (!o.wisersellOrderId) { results.push({ orderId: id, ok: false, message: 'wisersellOrderId yok' }); continue; }

    const isCg = CG_CODES.includes(o.warehouseCode);

    // Tracking kaynağı: CG → manualTracking; normal → SHIPPING etiketi (+ status SHIPPED).
    let trackingRaw: string | null | undefined;
    if (isCg) {
      trackingRaw = o.manualTracking;
      if (!trackingRaw) { results.push({ orderId: id, ok: false, message: 'CG tracking yok (önce manuel tracking girin)' }); continue; }
    } else {
      if (o.status !== 'SHIPPED') { results.push({ orderId: id, ok: false, message: `Henüz kargolanmadı (status ${o.status})` }); continue; }
      trackingRaw = o.labels[0]?.trackingNumber;
      if (!trackingRaw) { results.push({ orderId: id, ok: false, message: 'Tracking yok (SHIPPING etiketi eksik)' }); continue; }
    }

    // Virgüllü tracking'te ilkini al (Wayfair MCF birden çok koli tracking'i verebilir).
    const tracking = trackingRaw.split(',')[0].trim();

    // CG için carrier varsayılanı FedEx (Wayfair MCF FedEx kullanır); diğerinde prefix'ten türet.
    const carrierId = carrierIdOverride ?? carrierIdFromTracking(tracking) ?? (isCg ? WISERSELL_CARRIER_IDS.FEDEX : null);
    if (!carrierId) { results.push({ orderId: id, ok: false, message: `Carrier tracking'den belirlenemedi (${tracking}) — carrierIdOverride gerekli` }); continue; }

    // Throttle: ilk gerçek istekte değil, sonrakilerden önce bekle.
    if (processed > 0) await sleep(THROTTLE_MS);
    processed++;

    try {
      // 1) external-close (tracking yaz) → 2) platform-close (platformda kapat)
      await closeWisersellExternal(o.wisersellOrderId, carrierId, tracking);
      await platformCloseWithBackoff(o.wisersellOrderId);

      await prisma.outboundOrder.update({
        where: { id },
        data: {
          wisersellClosedAt: new Date(),
          // CG: fiziksel çıkış WMS'te yok → kapanışta SHIPPED işaretle (cgBekliyor → kapandı).
          ...(isCg && o.status !== 'SHIPPED' ? { status: 'SHIPPED', shippedAt: new Date(), shippedById: auth.user.id } : {}),
        },
      });
      results.push({ orderId: id, ok: true, message: `Kapatıldı (carrier ${carrierId})` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ orderId: id, ok: false, message: `Kapatma hatası: ${msg.slice(0, 150)}` });
    }
  }

  const closed = results.filter((r) => r.ok && !/Zaten/.test(r.message ?? '')).length;
  logger.info(`close: ${closed}/${orderIds.length} kapatıldı`);
  return NextResponse.json({ success: true, results, closed });
}
