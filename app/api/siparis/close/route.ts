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
import { requireOrderBoardLevel } from '@/lib/auth/orderBoardPermission';
import { isWayfairChannel } from '@/lib/wisersell/orderRouting';
import { closeWisersellExternal, closeWisersellPlatform, markWisersellOrderItems } from '@/lib/wisersell/databridgeClient';
import { carrierIdFromTracking, WISERSELL_CARRIER_IDS } from '@/lib/wisersell/carrierMap';
import { logAction } from '@/lib/auditLog';
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
  deferred?: boolean; // split: parça çıkışlandı ama kardeş bekleniyor → Wisersell kapatma ertelendi (kapanmadı)
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
  const { orderIds, carrierIdOverride } = parsed.data;

  const orders = await prisma.outboundOrder.findMany({
    where: { id: { in: orderIds }, source: { in: ['WISERSELL_AUTO', 'MANUAL'] } },
    include: { labels: { where: { type: 'SHIPPING', archivedAt: null }, select: { trackingNumber: true }, take: 1 } },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));

  // Bir parçanın (alt-sipariş) tracking + carrier'ını belirle (CG/Wayfair/normal). Split'te
  // her kardeş kendi tracking'iyle external-close edilir → ortak yardımcı.
  type PartLike = { warehouseCode: string; marketplaceCode: string | null; status: string; manualTracking: string | null; labels: { trackingNumber: string | null }[] };
  const resolvePartTracking = (o: PartLike): { ok: true; tracking: string; carrierId: number } | { ok: false; message: string } => {
    const isCg = CG_CODES.includes(o.warehouseCode);
    const isWayfair = isWayfairChannel(o.marketplaceCode);
    let trackingRaw: string | null | undefined;
    if (isCg) {
      trackingRaw = o.manualTracking;
      if (!trackingRaw) return { ok: false, message: 'CG tracking yok (önce manuel tracking girin)' };
    } else if (isWayfair) {
      if (o.status !== 'SHIPPED') return { ok: false, message: `Önce depodan çıkış yapın (status ${o.status})` };
      trackingRaw = o.manualTracking;
      if (!trackingRaw) return { ok: false, message: 'Wayfair tracking yok (önce manuel tracking girin)' };
    } else {
      if (o.status !== 'SHIPPED') return { ok: false, message: `Henüz kargolanmadı (status ${o.status})` };
      trackingRaw = o.labels[0]?.trackingNumber;
      if (!trackingRaw) return { ok: false, message: 'Tracking yok (SHIPPING etiketi eksik)' };
    }
    // Virgüllü tracking'te ilkini al (Wayfair MCF birden çok koli tracking'i verebilir).
    const tracking = trackingRaw.split(',')[0].trim();
    // CG için carrier varsayılanı FedEx (Wayfair MCF FedEx kullanır); diğerinde prefix'ten türet.
    const carrierId = carrierIdOverride ?? carrierIdFromTracking(tracking) ?? (isCg ? WISERSELL_CARRIER_IDS.FEDEX : null);
    if (!carrierId) return { ok: false, message: `Carrier tracking'den belirlenemedi (${tracking}) — carrierIdOverride gerekli` };
    return { ok: true, tracking, carrierId };
  };

  const results: CloseResult[] = [];
  let processed = 0; // gerçekten Wisersell'e gidilen sipariş sayısı (throttle için)

  for (const id of orderIds) {
    const o = byId.get(id);
    if (!o) { results.push({ orderId: id, ok: false, message: 'Sipariş bulunamadı' }); continue; }

    // MANUAL sipariş Wisersell'de YOK → Wisersell kapatma adımı yok. Manuel CG: MCF
    // export + tracking sonrası "kapat" = yerel SHIPPED (board "Kapandı"). WMS çıkışı CG'de yok.
    if (o.source === 'MANUAL') {
      if (o.status === 'SHIPPED') { results.push({ orderId: id, ok: true, message: 'Zaten kapandı' }); continue; }
      if (!CG_CODES.includes(o.warehouseCode)) { results.push({ orderId: id, ok: false, message: 'Manuel US siparişi depodan çıkışla kapanır (close gerekmez)' }); continue; }
      if (!o.manualTracking) { results.push({ orderId: id, ok: false, message: 'Önce tracking girin (Wayfair MCF raporundan)' }); continue; }
      await prisma.outboundOrder.update({
        where: { id },
        data: { status: 'SHIPPED', shippedAt: new Date(), shippedById: auth.user.id },
      });
      results.push({ orderId: id, ok: true, message: 'Kapatıldı (manuel CG — yerel)' });
      continue;
    }

    if (o.wisersellClosedAt) { results.push({ orderId: id, ok: true, message: 'Zaten kapatılmış' }); continue; }
    if (!o.wisersellOrderId) { results.push({ orderId: id, ok: false, message: 'wisersellOrderId yok' }); continue; }

    const isCg = CG_CODES.includes(o.warehouseCode);

    // Bu parçanın tracking/carrier doğrulaması.
    const tc = resolvePartTracking(o);
    if (!tc.ok) { results.push({ orderId: id, ok: false, message: tc.message }); continue; }

    // Bu parçanın orderitem'larını Teslim Edildi (6) yap (best-effort, rate-limit dışı).
    if (o.wisersellOrderItemIds.length) {
      try {
        await markWisersellOrderItems(o.wisersellOrderItemIds, 6);
      } catch (err: unknown) {
        logger.error(`orderitem Teslim Edildi yazılamadı (order ${o.wisersellOrderId}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Split sevk: bir Wisersell siparişi → N kardeş alt-sipariş. platform-close sipariş
    // seviyesi → YALNIZCA tüm kardeşler SHIPPED olunca çalışmalı (yoksa bir parça erken
    // kapatılınca tüm sipariş kapanır). Kardeşleri çek.
    const siblings = await prisma.outboundOrder.findMany({
      where: { wisersellOrderId: o.wisersellOrderId, source: 'WISERSELL_AUTO', status: { not: 'CANCELLED' } },
      select: { id: true, warehouseCode: true, marketplaceCode: true, status: true, manualTracking: true, labels: { where: { type: 'SHIPPING', archivedAt: null }, select: { trackingNumber: true }, take: 1 } },
    });
    const others = siblings.filter((s) => s.id !== o.id);
    const allOthersShipped = others.every((s) => s.status === 'SHIPPED');

    if (!allOthersShipped) {
      // Bu parça çıkışlandı; Wisersell kapatması ertelenir (kardeş bekleniyor).
      // CG parçasında fiziksel çıkış WMS'te yok → burada SHIPPED işaretle.
      if (isCg && o.status !== 'SHIPPED') {
        await prisma.outboundOrder.update({ where: { id }, data: { status: 'SHIPPED', shippedAt: new Date(), shippedById: auth.user.id } });
      }
      results.push({ orderId: id, ok: true, deferred: true, message: `Parça çıkışlandı (${o.warehouseCode}); ${others.length} kardeş bekleniyor — Wisersell kapatma ertelendi` });
      continue;
    }

    // Tüm parçalar sevk edildi → komple Wisersell siparişini kapat. Her kardeş kendi
    // carrier+tracking'iyle external-close, sonra platform-close 1 kez.
    const closeSet: Array<{ carrierId: number; tracking: string }> = [];
    let partErr: string | null = null;
    for (const s of siblings) {
      const stc = s.id === o.id ? tc : resolvePartTracking(s);
      if (!stc.ok) { partErr = `Kardeş (${s.warehouseCode}) kapatılamıyor: ${stc.message}`; break; }
      closeSet.push({ carrierId: stc.carrierId, tracking: stc.tracking });
    }
    if (partErr) { results.push({ orderId: id, ok: false, message: partErr }); continue; }

    // Throttle: ilk gerçek istekte değil, sonrakilerden önce bekle.
    if (processed > 0) await sleep(THROTTLE_MS);
    processed++;

    try {
      // 1) external-close (her parça kendi tracking'i) → 2) platform-close (1 kez)
      for (const p of closeSet) {
        await closeWisersellExternal(o.wisersellOrderId, p.carrierId, p.tracking);
      }
      await platformCloseWithBackoff(o.wisersellOrderId);

      const now = new Date();
      // CG parçaları (fiziksel çıkış WMS'te yok) → SHIPPED işaretle.
      await prisma.outboundOrder.updateMany({
        where: { wisersellOrderId: o.wisersellOrderId, status: { not: 'SHIPPED' } },
        data: { status: 'SHIPPED', shippedAt: now, shippedById: auth.user.id },
      });
      // Tüm kardeşlere wisersellClosedAt.
      await prisma.outboundOrder.updateMany({
        where: { wisersellOrderId: o.wisersellOrderId },
        data: { wisersellClosedAt: now },
      });
      results.push({ orderId: id, ok: true, message: siblings.length > 1 ? `Kapatıldı (ayrı sevk — ${siblings.length} parça)` : `Kapatıldı (carrier ${tc.carrierId})` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ orderId: id, ok: false, message: `Kapatma hatası: ${msg.slice(0, 150)}` });
    }
  }

  const closed = results.filter((r) => r.ok && !r.deferred && !/Zaten/.test(r.message ?? '')).length;
  const deferred = results.filter((r) => r.deferred).length;
  logger.info(`close: ${closed}/${orderIds.length} kapatıldı${deferred ? `, ${deferred} ertelendi (kardeş bekleniyor)` : ''}`);
  if (closed > 0) {
    await logAction({
      userId: auth.user.id, userName: auth.user.name, userEmail: auth.user.email,
      action: 'CLOSE_ORDER', entityType: 'OutboundOrder',
      entityId: results.filter((r) => r.ok && !r.deferred && !/Zaten/.test(r.message ?? '')).map((r) => r.orderId).join(','),
      description: `${closed} sipariş Wisersell'de kapatıldı`,
    });
  }
  return NextResponse.json({ success: true, results, closed, deferred });
}
