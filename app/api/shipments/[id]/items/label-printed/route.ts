/**
 * Fairfield EAN ürün etiketi basıldı işareti — kalemleri labelPrintedAt ile damgalar.
 * Depo görsel takibi: basılan satır UI'da yeşile döner (kalıcı, sayfa yenilense de).
 * Tekrar basıma izin verilir; işaret kaldırılmaz.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const Schema = z.object({ itemIds: z.array(z.string().uuid()).min(1) });

export const PATCH = withRoute<{ id: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Etiket durumu güncellenemedi' },
  async ({ request, params }) => {
    const { id } = params;
    const shipment = await prisma.shipment.findUnique({ where: { id } });
    if (!shipment) return NextResponse.json({ success: false, error: 'Sevkiyat bulunamadı' }, { status: 404 });

    const auth = await requireShipmentAction(request, shipment.destinationTab, 'manageBoxes');
    if (auth instanceof NextResponse) return auth;

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
    }
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Geçersiz kalem listesi' }, { status: 400 });
    }

    const result = await prisma.shipmentItem.updateMany({
      where: { id: { in: parsed.data.itemIds }, shipmentId: id },
      data: { labelPrintedAt: new Date() },
    });
    return successResponse({ updated: result.count });
  }
);
