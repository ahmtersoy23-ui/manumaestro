/**
 * Container satır (line) yönetimi — karışık koli/palete ürün koy/çıkar.
 * POST   ?               body {shipmentItemId, quantity}  → satır ekle
 * DELETE ?lineId=xxx                                      → satır sil
 * Her ikisi de ilgili ShipmentItem.packed'i yeniden hesaplar (kalan=0 → packed).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';
import type { Prisma } from '@prisma/client';

const DEPOT_DESTINATIONS = ['NJ_DEPO', 'CG_DEPO'];

async function recomputePacked(tx: Prisma.TransactionClient, shipmentId: string, itemId: string) {
  const item = await tx.shipmentItem.findUnique({ where: { id: itemId } });
  if (!item) return;
  const agg = await tx.shipmentContainerLine.aggregate({
    _sum: { quantity: true },
    where: { shipmentItemId: itemId, container: { shipmentId } },
  });
  const placed = agg._sum.quantity ?? 0;
  await tx.shipmentItem.update({ where: { id: itemId }, data: { packed: placed >= item.quantity } });
}

const AddSchema = z.object({
  shipmentItemId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const POST = withRoute<{ id: string; containerId: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Satır eklenemedi' },
  async ({ request, params }) => {
    const { id, containerId } = params;
    const shipment = await prisma.shipment.findUnique({ where: { id } });
    if (!shipment) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadı' }, { status: 404 });

    const auth = await requireShipmentAction(request, shipment.destinationTab, 'manageBoxes');
    if (auth instanceof NextResponse) return auth;

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
    }
    const parsed = AddSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'shipmentItemId + pozitif quantity gerekli' }, { status: 400 });
    }
    const { shipmentItemId, quantity } = parsed.data;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const container = await tx.shipmentContainer.findUnique({ where: { id: containerId } });
        if (!container || container.shipmentId !== id) throw new Error('Konteyner bulunamadı');

        const item = await tx.shipmentItem.findUnique({ where: { id: shipmentItemId } });
        if (!item || item.shipmentId !== id) throw new Error('Kalem bu sevkiyatta değil');
        if (!item.recommendedDestination || !DEPOT_DESTINATIONS.includes(item.recommendedDestination)) {
          throw new Error('Sadece Fairfield / CG Depo kalemleri konsolide edilir');
        }

        const agg = await tx.shipmentContainerLine.aggregate({
          _sum: { quantity: true },
          where: { shipmentItemId, container: { shipmentId: id } },
        });
        const placed = agg._sum.quantity ?? 0;
        const remaining = item.quantity - placed;
        if (quantity > remaining) {
          throw new Error(`Kalan ${remaining} adet — ${quantity} eklenemez`);
        }

        const line = await tx.shipmentContainerLine.create({
          data: { containerId, shipmentItemId, iwasku: item.iwasku, quantity },
        });
        await recomputePacked(tx, id, shipmentItemId);
        return line;
      });
      return successResponse(result);
    } catch (e) {
      return NextResponse.json(
        { success: false, error: e instanceof Error ? e.message : 'Satır eklenemedi' },
        { status: 400 }
      );
    }
  }
);

export const DELETE = withRoute<{ id: string; containerId: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Satır silinemedi' },
  async ({ request, params }) => {
    const { id, containerId } = params;
    const shipment = await prisma.shipment.findUnique({ where: { id } });
    if (!shipment) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadı' }, { status: 404 });

    const auth = await requireShipmentAction(request, shipment.destinationTab, 'manageBoxes');
    if (auth instanceof NextResponse) return auth;

    const lineId = new URL(request.url).searchParams.get('lineId');
    if (!lineId) return NextResponse.json({ success: false, error: 'lineId gerekli' }, { status: 400 });

    try {
      await prisma.$transaction(async (tx) => {
        const line = await tx.shipmentContainerLine.findUnique({ where: { id: lineId } });
        if (!line || line.containerId !== containerId) throw new Error('Satır bulunamadı');
        await tx.shipmentContainerLine.delete({ where: { id: lineId } });
        await recomputePacked(tx, id, line.shipmentItemId);
      });
      return successResponse({ deleted: true });
    } catch (e) {
      return NextResponse.json(
        { success: false, error: e instanceof Error ? e.message : 'Satır silinemedi' },
        { status: 400 }
      );
    }
  }
);
