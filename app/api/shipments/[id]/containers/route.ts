/**
 * Shipment Containers API — depo (NJ_DEPO/CG_DEPO) konsolidasyon koli/palet.
 * GET:  container listesi + paketlenebilir depo kalemleri (kalan miktarla).
 * POST: yeni container (KOLI|PALET) — oto-numara.
 *
 * Karışık ürün: bir container birden çok farklı iwasku satırı tutar
 * (shipment_container_lines). FBA tek-SKU shipment_boxes'tan AYRI.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentView, requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { getShipmentRole, canDoAction } from '@/lib/auth/shipmentPermission';
import { getProductsByIwasku } from '@/lib/products/lookup';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse, createdResponse } from '@/lib/api/response';

const DEPOT_DESTINATIONS = ['NJ_DEPO', 'CG_DEPO'];

function shipmentPrefix(name: string): string {
  const m = name.match(/\d+/);
  return m ? m[0] : name.split(/[\s-]/)[0];
}

export const GET = withRoute<{ id: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Konteynerler yüklenemedi' },
  async ({ request, params }) => {
    const auth = await requireShipmentView(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    // requireShipmentView non-admin'e generic VIEWER döndürür; UI gating için
    // bu destinasyondaki GERÇEK rolü hesapla (PACKER/MANAGER → manageBoxes).
    const shipmentMeta = await prisma.shipment.findUnique({ where: { id }, select: { destinationTab: true } });
    if (!shipmentMeta) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadı' }, { status: 404 });
    const realRole = await getShipmentRole(auth.user.id, auth.user.role, shipmentMeta.destinationTab);
    const canManage = canDoAction(realRole, 'manageBoxes');

    const [containers, items] = await Promise.all([
      prisma.shipmentContainer.findMany({
        where: { shipmentId: id },
        include: { lines: true },
        orderBy: { code: 'asc' },
      }),
      prisma.shipmentItem.findMany({
        where: { shipmentId: id, recommendedDestination: { in: DEPOT_DESTINATIONS } },
        orderBy: { iwasku: 'asc' },
      }),
    ]);

    // Kalem başına yerleştirilen miktar
    const placedByItem = new Map<string, number>();
    for (const c of containers) {
      for (const l of c.lines) {
        placedByItem.set(l.shipmentItemId, (placedByItem.get(l.shipmentItemId) ?? 0) + l.quantity);
      }
    }

    const iwaskus = [...new Set([...items.map((i) => i.iwasku), ...containers.flatMap((c) => c.lines.map((l) => l.iwasku))])];
    const productMap = iwaskus.length > 0 ? await getProductsByIwasku(iwaskus) : new Map();

    const mpIds = [...new Set(items.map((i) => i.marketplaceId).filter(Boolean) as string[])];
    const mps = mpIds.length > 0
      ? await prisma.marketplace.findMany({ where: { id: { in: mpIds } }, select: { id: true, code: true } })
      : [];
    const mpCode = new Map(mps.map((m) => [m.id, m.code]));

    return successResponse({
      role: realRole,
      canManage,
      containers: containers.map((c) => ({
        id: c.id,
        type: c.type,
        code: c.code,
        labelPrinted: c.labelPrinted,
        width: c.width,
        height: c.height,
        depth: c.depth,
        weight: c.weight,
        lines: c.lines.map((l) => ({
          id: l.id,
          shipmentItemId: l.shipmentItemId,
          iwasku: l.iwasku,
          name: productMap.get(l.iwasku)?.name ?? null,
          quantity: l.quantity,
        })),
      })),
      items: items.map((it) => {
        const placed = placedByItem.get(it.id) ?? 0;
        return {
          id: it.id,
          iwasku: it.iwasku,
          name: productMap.get(it.iwasku)?.name ?? null,
          ean: productMap.get(it.iwasku)?.ean ?? null,
          quantity: it.quantity,
          placed,
          remaining: it.quantity - placed,
          labelPrintedAt: it.labelPrintedAt ? it.labelPrintedAt.toISOString() : null,
          recommendedDestination: it.recommendedDestination,
          marketplaceCode: it.marketplaceId ? mpCode.get(it.marketplaceId) ?? null : null,
        };
      }),
    });
  }
);

const CreateSchema = z.object({ type: z.enum(['KOLI', 'PALET']) });

export const POST = withRoute<{ id: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Konteyner oluşturulamadı' },
  async ({ request, params }) => {
    const { id } = params;
    const shipment = await prisma.shipment.findUnique({ where: { id } });
    if (!shipment) {
      return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadı' }, { status: 404 });
    }

    const auth = await requireShipmentAction(request, shipment.destinationTab, 'manageBoxes');
    if (auth instanceof NextResponse) return auth;

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
    }
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'type KOLI|PALET olmalı' }, { status: 400 });
    }
    const { type } = parsed.data;

    const prefix = shipmentPrefix(shipment.name);
    const letter = type === 'PALET' ? 'P' : 'K';
    const countSame = await prisma.shipmentContainer.count({ where: { shipmentId: id, type } });
    const code = `${prefix}-${letter}${String(countSame + 1).padStart(2, '0')}`;

    const created = await prisma.shipmentContainer.create({
      data: { shipmentId: id, type, code },
    });
    return createdResponse(created);
  }
);
