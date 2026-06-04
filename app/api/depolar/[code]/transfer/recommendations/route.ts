/**
 * GET /api/depolar/[code]/transfer/recommendations
 *
 * Somerset (NJ) → Fairfield (SHOWROOM) transfer önerileri. Yalnız NJ deposunda.
 *
 * Aday ürün kümesi iki olaydan doğar (zaman penceresi YOK — olay-tabanlı):
 *   C1) Fairfield'dan hiç çıkış yapılmış (Fairfield'da talebi var).
 *   C2) Somerset'te hiç koli kırılmış (BOX_OPEN/BOX_BREAK) — Fairfield'da olmayan
 *       ürün Somerset'ten çıkarken koli parçalanmış, kalan tekil transfere uygun.
 *
 * Bu adayların güncel durumu SHOWROOM<=0 ve NJ>0 ise öneri listelenir. Liste
 * kendi kendini temizler: transfer yapılınca SHOWROOM>0 olur veya NJ biter →
 * satır düşer. Hedef raf SHOWROOM'un POOL rafıdır (cross-warehouse zorunluluğu).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { canDoShelfAction } from '@/lib/auth/shelfPermission';
import { getUsAvailability } from '@/lib/wms/usWarehouseStock';
import { getProductsByIwasku } from '@/lib/products/lookup';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Transfer önerileri alınamadı' },
  async ({ request, params }) => {
    const upperCode = params.code.toUpperCase();

    // Öneri yalnız Somerset (NJ) tarafında — aksiyon burada yapılır.
    if (upperCode !== 'NJ') {
      return NextResponse.json(
        { success: false, error: 'Transfer önerileri yalnız Somerset (NJ) deposunda' },
        { status: 400 }
      );
    }

    const auth = await requireShelfAction(request, upperCode, 'view');
    if (auth instanceof NextResponse) return auth;

    // C1: Fairfield'dan çıkışı yapılmış ürünler + son çıkış tarihi
    const showroomShipped = await prisma.outboundOrder.findMany({
      where: { warehouseCode: 'SHOWROOM', status: 'SHIPPED' },
      select: { shippedAt: true, items: { select: { iwasku: true } } },
    });
    const c1Last = new Map<string, Date>();
    for (const o of showroomShipped) {
      if (!o.shippedAt) continue;
      for (const it of o.items) {
        const prev = c1Last.get(it.iwasku);
        if (!prev || o.shippedAt > prev) c1Last.set(it.iwasku, o.shippedAt);
      }
    }

    // C2: Somerset'te koli kırılmış ürünler + son kırma tarihi
    const njBreaks = await prisma.shelfMovement.findMany({
      where: { warehouseCode: 'NJ', type: { in: ['BOX_OPEN', 'BOX_BREAK'] }, iwasku: { not: null } },
      select: { iwasku: true, createdAt: true },
    });
    const c2Last = new Map<string, Date>();
    for (const m of njBreaks) {
      if (!m.iwasku) continue;
      const prev = c2Last.get(m.iwasku);
      if (!prev || m.createdAt > prev) c2Last.set(m.iwasku, m.createdAt);
    }

    const candidates = [...new Set([...c1Last.keys(), ...c2Last.keys()])];

    // Hedef raf: SHOWROOM POOL (cross-warehouse transfer hedefi POOL/TEMP olmalı)
    const destShelf = await prisma.shelf.findFirst({
      where: { warehouseCode: 'SHOWROOM', shelfType: 'POOL', isActive: true },
      select: { id: true, code: true },
    });

    let items: {
      iwasku: string;
      name: string | null;
      nj: number;
      reasons: ('SHOWROOM_OUT' | 'BOX_OPEN')[];
      lastEvent: string;
    }[] = [];

    if (candidates.length > 0) {
      const avail = await getUsAvailability(candidates);
      const eligible = candidates.filter((iw) => {
        const a = avail.get(iw) ?? { NJ: 0, SHOWROOM: 0 };
        return a.SHOWROOM <= 0 && a.NJ > 0;
      });
      if (eligible.length > 0) {
        // Yok sayılanlar: dismissedAt son olaydan SONRAYSA gizle (yeni olay → tekrar belirir)
        const dismissals = await prisma.transferDismissal.findMany({
          where: { iwasku: { in: eligible } },
          select: { iwasku: true, dismissedAt: true },
        });
        const dismissedAt = new Map(dismissals.map((d) => [d.iwasku, d.dismissedAt]));

        const productMap = await getProductsByIwasku(eligible);
        items = eligible
          .filter((iw) => {
            const d = dismissedAt.get(iw);
            if (!d) return true;
            const lastEvent = Math.max(
              c1Last.get(iw)?.getTime() ?? 0,
              c2Last.get(iw)?.getTime() ?? 0
            );
            return d.getTime() < lastEvent; // dismiss sonrası yeni olay olduysa göster
          })
          .map((iw) => {
            const reasons: ('SHOWROOM_OUT' | 'BOX_OPEN')[] = [];
            if (c1Last.has(iw)) reasons.push('SHOWROOM_OUT');
            if (c2Last.has(iw)) reasons.push('BOX_OPEN');
            const dates = [c1Last.get(iw), c2Last.get(iw)].filter(Boolean) as Date[];
            const lastEvent = new Date(Math.max(...dates.map((d) => d.getTime())));
            return {
              iwasku: iw,
              name: productMap.get(iw)?.name ?? null,
              nj: avail.get(iw)?.NJ ?? 0,
              reasons,
              lastEvent: lastEvent.toISOString(),
            };
          })
          .sort((a, b) => b.lastEvent.localeCompare(a.lastEvent));
      }
    }

    return successResponse({
      role: auth.shelfRole,
      canTransfer: canDoShelfAction(auth.shelfRole, 'crossWarehouseTransfer'),
      destination: destShelf,
      items,
    });
  }
);
