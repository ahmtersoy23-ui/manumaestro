/**
 * POST /api/siparis/label-cost  { orderId, cost, currency? }   (Manager+)
 *
 * Veeqo-DIŞI (elle yüklenen) kargo etiketinin bedelini elle girer/günceller — operatör
 * ayrı liste tutmasın, tüm bedeller tek yerde (mutabakat/Kapandı export). Veeqo etiketinde
 * bedel zaten book'tan otomatik gelir → değiştirilemez (yanlışlıkla ezilmesin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireBoardManager } from '@/lib/auth/boardAuth';

const Schema = z.object({
  orderId: z.string().uuid(),
  cost: z.number().min(0).max(100000),
  currency: z.string().trim().min(1).max(8).optional(),
});

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
  const { orderId, cost, currency } = parsed.data;

  const label = await prisma.orderLabel.findFirst({
    where: { outboundOrderId: orderId, type: 'SHIPPING', archivedAt: null },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, veeqoShipmentId: true },
  });
  if (!label) {
    return NextResponse.json({ success: false, error: 'Bu siparişte kargo etiketi yok' }, { status: 404 });
  }
  if (label.veeqoShipmentId) {
    return NextResponse.json({ success: false, error: 'Veeqo etiketinin bedeli otomatik gelir — elle değiştirilemez' }, { status: 409 });
  }

  await prisma.orderLabel.update({
    where: { id: label.id },
    data: { cost, costCurrency: currency || 'USD' },
  });

  return NextResponse.json({ success: true, cost, currency: currency || 'USD' });
}
