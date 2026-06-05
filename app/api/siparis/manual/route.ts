/**
 * POST /api/siparis/manual
 *
 * Süper-admin: Sipariş board'ında elle sipariş oluşturur (Wisersell'de OLMAYAN,
 * etiketi başka platformdan alınmış müşteri siparişleri). DRAFT + source=MANUAL →
 * board'da "Etiket Bekliyor"a düşer, oradan etiket/tracking + çıkış (FIFO) aynı
 * pipeline'dan ilerler. Depodan çıkış = kapandı (Wisersell kapama YOK).
 *
 * Depo bazlı `POST /api/depolar/[code]/siparis` ile aynı validasyon (Fairfield
 * öncelikli stok + dup), ama shelf/marketplace izni yerine süper-admin gate'i.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireBoardUser } from '@/lib/auth/boardAuth';
import { getUsAvailability, outboundBlockMessage, type UsWarehouse } from '@/lib/wms/usWarehouseStock';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SiparisManual');

const ItemSchema = z.object({
  iwasku: z.string().trim().min(1),
  quantity: z.number().int().positive().max(100000),
});

const Schema = z.object({
  warehouseCode: z.enum(['NJ', 'SHOWROOM']),
  marketplaceCode: z.string().trim().min(1).max(50),
  orderNumber: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  addressNote: z.string().trim().max(2000).optional(),
  items: z.array(ItemSchema).min(1).max(50),
});

export async function POST(request: NextRequest) {
  const auth = await requireBoardUser(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { warehouseCode, marketplaceCode, orderNumber, description, addressNote, items } = parsed.data;

  // Stok kuralı: kalem ancak doğru US deposundan girilebilir (Fairfield önceliği).
  const qtyByIwasku = new Map<string, number>();
  for (const it of items) qtyByIwasku.set(it.iwasku, (qtyByIwasku.get(it.iwasku) ?? 0) + it.quantity);
  const avail = await getUsAvailability([...qtyByIwasku.keys()], { subtractPendingDraft: true });
  const problems: string[] = [];
  for (const [iwasku, qty] of qtyByIwasku) {
    const a = avail.get(iwasku) ?? { NJ: 0, SHOWROOM: 0 };
    const msg = outboundBlockMessage(warehouseCode as UsWarehouse, iwasku, qty, a);
    if (msg) problems.push(msg);
  }
  if (problems.length > 0) {
    return NextResponse.json({ success: false, error: problems.join('\n') }, { status: 400 });
  }

  // Aynı (warehouse, marketplace, orderNumber) zaten DRAFT/SHIPPED ise hata
  const dup = await prisma.outboundOrder.findUnique({
    where: { warehouseCode_marketplaceCode_orderNumber: { warehouseCode, marketplaceCode, orderNumber } },
  });
  if (dup) {
    return NextResponse.json(
      { success: false, error: `Bu marketplace + sipariş no zaten var (status: ${dup.status})` },
      { status: 409 },
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.outboundOrder.create({
      data: {
        warehouseCode,
        orderType: 'SINGLE',
        marketplaceCode,
        orderNumber,
        description: description ?? null,
        addressNote: addressNote ?? null,
        status: 'DRAFT',
        source: 'MANUAL',
        createdById: auth.user.id,
      },
    });
    await tx.outboundOrderItem.createMany({
      data: items.map((it) => ({ outboundOrderId: order.id, iwasku: it.iwasku, quantity: it.quantity })),
    });
    return order;
  });

  logger.info(`manual order created: ${created.id} (${warehouseCode} ${marketplaceCode} ${orderNumber}, ${items.length} kalem)`);
  return NextResponse.json({ success: true, id: created.id, orderNumber: created.orderNumber });
}
