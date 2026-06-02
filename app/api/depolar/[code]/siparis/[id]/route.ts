/**
 * GET /api/depolar/[code]/siparis/[id]
 * Sipariş detayı + kalemler + ürün adları (products lookup).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getMarketplaceAccess, canEditMarketplace } from '@/lib/auth/marketplaceAccess';
import { getUsAvailability, outboundBlockMessage, type UsWarehouse } from '@/lib/wms/usWarehouseStock';
import { getProductsByIwasku, usDimensions } from '@/lib/products/lookup';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const SHELF_PRIMARY = new Set(['NJ', 'SHOWROOM']);

const EditOrderSchema = z.object({
  marketplaceCode: z.string().trim().min(1).max(50),
  orderNumber: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  addressNote: z.string().trim().max(2000).optional(),
  items: z
    .array(z.object({ iwasku: z.string().trim().min(1), quantity: z.number().int().positive().max(100000) }))
    .min(1)
    .max(50),
});

export const GET = withRoute<{ code: string; id: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Sipariş detayı alınamadı' },
  async ({ request, params }) => {
    const { code, id } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }

    const auth = await requireShelfAction(request, upperCode, 'view');
    if (auth instanceof NextResponse) return auth;

    const order = await prisma.outboundOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order || order.warehouseCode !== upperCode) {
      return NextResponse.json({ success: false, error: 'Sipariş bulunamadı' }, { status: 404 });
    }

    // Kalemlerin raf/koli detaylarını topla
    const shelfIds = order.items.map((i) => i.shelfId).filter(Boolean) as string[];
    const boxIds = order.items.map((i) => i.shelfBoxId).filter(Boolean) as string[];

    const [shelves, boxes] = await Promise.all([
      shelfIds.length > 0
        ? prisma.shelf.findMany({ where: { id: { in: shelfIds } }, select: { id: true, code: true } })
        : Promise.resolve([]),
      boxIds.length > 0
        ? prisma.shelfBox.findMany({
            where: { id: { in: boxIds } },
            select: { id: true, boxNumber: true, shelfId: true, status: true, quantity: true, reservedQty: true },
          })
        : Promise.resolve([]),
    ]);

    const shelfMap = new Map(shelves.map((s) => [s.id, s]));
    const boxMap = new Map(boxes.map((b) => [b.id, b]));

    // Box'ların shelf code'u için ek lookup
    const boxShelfIds = boxes.map((b) => b.shelfId);
    const boxShelves =
      boxShelfIds.length > 0
        ? await prisma.shelf.findMany({ where: { id: { in: boxShelfIds } }, select: { id: true, code: true } })
        : [];
    const boxShelfMap = new Map(boxShelves.map((s) => [s.id, s.code]));

    const productMap = await getProductsByIwasku(order.items.map((i) => i.iwasku));

    return successResponse({
      role: auth.shelfRole,
      order: {
        id: order.id,
        orderType: order.orderType,
        marketplaceCode: order.marketplaceCode,
        orderNumber: order.orderNumber,
        description: order.description,
        addressNote: order.addressNote,
        status: order.status,
        createdAt: order.createdAt,
        shippedAt: order.shippedAt,
      },
      items: order.items.map((item) => {
        const box = item.shelfBoxId ? boxMap.get(item.shelfBoxId) : null;
        return {
          id: item.id,
          iwasku: item.iwasku,
          productName: productMap.get(item.iwasku)?.name ?? null,
          dims: usDimensions(productMap.get(item.iwasku)),
          quantity: item.quantity,
          shelfId: item.shelfId,
          shelfCode: item.shelfId ? shelfMap.get(item.shelfId)?.code ?? null : box ? boxShelfMap.get(box.shelfId) ?? null : null,
          shelfBoxId: item.shelfBoxId,
          boxNumber: box?.boxNumber ?? null,
          boxStatus: box?.status ?? null,
        };
      }),
    });
  }
);

/**
 * PUT /api/depolar/[code]/siparis/[id]
 * DRAFT + SINGLE siparişi düzenle: başlık (pazaryeri, sipariş no, adres) +
 * kalemler (tamamen değiştirilir). Stok validasyonu create ile aynı.
 */
export const PUT = withRoute<{ code: string; id: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Sipariş güncellenemedi' },
  async ({ request, params }) => {
    const { code, id } = params;
    const upperCode = code.toUpperCase();

    if (!SHELF_PRIMARY.has(upperCode)) {
      return NextResponse.json(
        { success: false, error: 'Sipariş çıkışı yalnız NJ ve SHOWROOM depolarında' },
        { status: 400 }
      );
    }
    const auth = await requireShelfAction(request, upperCode, 'createOutbound');
    if (auth instanceof NextResponse) return auth;

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
    }
    const parsed = EditOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { marketplaceCode, orderNumber, description, addressNote, items } = parsed.data;

    const existing = await prisma.outboundOrder.findUnique({ where: { id } });
    if (!existing || existing.warehouseCode !== upperCode) {
      return NextResponse.json({ success: false, error: 'Sipariş bulunamadı' }, { status: 404 });
    }
    if (existing.status !== 'DRAFT') {
      return NextResponse.json({ success: false, error: 'Sadece DRAFT siparişler düzenlenir' }, { status: 400 });
    }
    if (existing.orderType !== 'SINGLE') {
      return NextResponse.json({ success: false, error: 'Yalnız tekil (SINGLE) siparişler form ile düzenlenir' }, { status: 400 });
    }

    // Yeni pazaryeri için edit yetkisi
    const mpAccess = await getMarketplaceAccess(auth.user.id, auth.user.role);
    if (!canEditMarketplace(mpAccess, marketplaceCode)) {
      return NextResponse.json(
        { success: false, error: `${marketplaceCode} pazaryerinde sipariş düzenleme yetkiniz yok` },
        { status: 403 }
      );
    }

    // Aynı (warehouse, marketplace, orderNumber) başka bir siparişte var mı?
    const dup = await prisma.outboundOrder.findUnique({
      where: { warehouseCode_marketplaceCode_orderNumber: { warehouseCode: upperCode, marketplaceCode, orderNumber } },
    });
    if (dup && dup.id !== id) {
      return NextResponse.json(
        { success: false, error: `Bu marketplace + sipariş no zaten var (status: ${dup.status})` },
        { status: 409 }
      );
    }

    // Stok kuralı (create ile aynı): doğru US deposu + Fairfield önceliği
    const qtyByIwasku = new Map<string, number>();
    for (const it of items) qtyByIwasku.set(it.iwasku, (qtyByIwasku.get(it.iwasku) ?? 0) + it.quantity);
    const avail = await getUsAvailability([...qtyByIwasku.keys()]);
    const problems: string[] = [];
    for (const [iwasku, qty] of qtyByIwasku) {
      const a = avail.get(iwasku) ?? { NJ: 0, SHOWROOM: 0 };
      const msg = outboundBlockMessage(upperCode as UsWarehouse, iwasku, qty, a);
      if (msg) problems.push(msg);
    }
    if (problems.length > 0) {
      return NextResponse.json({ success: false, error: problems.join('\n') }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Mevcut kalemlerin rezervlerini geri al (legacy raf-bağlı kalemler için), sonra sil
      const oldItems = await tx.outboundOrderItem.findMany({ where: { outboundOrderId: id } });
      for (const it of oldItems) {
        if (it.shelfBoxId) {
          await tx.shelfBox.updateMany({
            where: { id: it.shelfBoxId },
            data: { reservedQty: { decrement: it.quantity } },
          });
        } else if (it.shelfId) {
          const stock = await tx.shelfStock.findUnique({
            where: { shelfId_iwasku: { shelfId: it.shelfId, iwasku: it.iwasku } },
          });
          if (stock) {
            await tx.shelfStock.update({
              where: { id: stock.id },
              data: { reservedQty: { decrement: it.quantity } },
            });
          }
        }
      }
      await tx.outboundOrderItem.deleteMany({ where: { outboundOrderId: id } });
      await tx.outboundOrder.update({
        where: { id },
        data: {
          marketplaceCode,
          orderNumber,
          description: description ?? null,
          addressNote: addressNote ?? null,
        },
      });
      await tx.outboundOrderItem.createMany({
        data: items.map((it) => ({ outboundOrderId: id, iwasku: it.iwasku, quantity: it.quantity })),
      });
      return tx.outboundOrder.findUnique({ where: { id } });
    });

    return successResponse(updated);
  }
);
