/**
 * GET  /api/depolar/[code]/siparis  — sipariş listesi (filtre: status, orderType)
 * POST /api/depolar/[code]/siparis  — yeni DRAFT yarat
 *
 * Sipariş çıkışı yalnız NJ + SHOWROOM'da; ANKARA için 400.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { getMarketplaceAccess, canEditMarketplace } from '@/lib/auth/marketplaceAccess';
import { getUsAvailability, outboundBlockMessage, type UsWarehouse } from '@/lib/wms/usWarehouseStock';
import { findChannelDuplicate, duplicateMessage } from '@/lib/wms/orderDuplicateGuard';
import { getProductsByIwasku } from '@/lib/products/lookup';
import type { Prisma } from '@prisma/client';
import { withRoute } from '@/lib/api/withRoute';
import { createdResponse } from '@/lib/api/response';

const SHELF_PRIMARY = new Set(['NJ', 'SHOWROOM']);

const CreateOrderItemSchema = z.object({
  iwasku: z.string().trim().min(1),
  quantity: z.number().int().positive().max(100000),
});

const CreateOrderSchema = z.object({
  orderType: z.enum(['SINGLE', 'FBA_PICKUP']),
  marketplaceCode: z.string().trim().min(1).max(50),
  orderNumber: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  addressNote: z.string().trim().max(2000).optional(),
  items: z.array(CreateOrderItemSchema).max(50).optional(),
});

export const GET = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Sipariş listesi alınamadı' },
  async ({ request, params }) => {
    const { code } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }
    if (!SHELF_PRIMARY.has(upperCode)) {
      return NextResponse.json(
        { success: false, error: 'Sipariş çıkışı yalnız NJ ve SHOWROOM depolarında' },
        { status: 400 }
      );
    }

    const auth = await requireShelfAction(request, upperCode, 'view');
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');
    const typeFilter = searchParams.get('orderType');
    const marketplaceFilter = searchParams.get('marketplaceCode');

    const where: Prisma.OutboundOrderWhereInput = { warehouseCode: upperCode };
    if (statusFilter && ['DRAFT', 'SHIPPED', 'CANCELLED'].includes(statusFilter)) {
      where.status = statusFilter as 'DRAFT' | 'SHIPPED' | 'CANCELLED';
    }
    if (typeFilter && ['SINGLE', 'FBA_PICKUP'].includes(typeFilter)) {
      where.orderType = typeFilter as 'SINGLE' | 'FBA_PICKUP';
    }
    if (marketplaceFilter) {
      where.marketplaceCode = marketplaceFilter;
    }

    const orders = await prisma.outboundOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        _count: { select: { items: true } },
        items: { select: { iwasku: true, quantity: true } },
        labels: {
          where: { type: 'SHIPPING', archivedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    });

    // Liste kalemleri için ürün adlarını topluca çöz (iwasku → name)
    const allIwaskus = [...new Set(orders.flatMap((o) => o.items.map((i) => i.iwasku)))];
    const productMap = allIwaskus.length > 0 ? await getProductsByIwasku(allIwaskus) : new Map();

    const counts = await prisma.outboundOrder.groupBy({
      by: ['status', 'orderType'],
      where: { warehouseCode: upperCode },
      _count: true,
    });

    let canEditMp: boolean | undefined;
    if (marketplaceFilter) {
      const mpAccess = await getMarketplaceAccess(auth.user.id, auth.user.role);
      canEditMp = canEditMarketplace(mpAccess, marketplaceFilter);
    }

    return NextResponse.json({
      success: true,
      data: {
        role: auth.shelfRole,
        ...(canEditMp !== undefined ? { canEditMarketplace: canEditMp } : {}),
        orders: orders.map((o) => ({
          id: o.id,
          orderType: o.orderType,
          marketplaceCode: o.marketplaceCode,
          orderNumber: o.orderNumber,
          description: o.description,
          addressNote: o.addressNote,
          status: o.status,
          itemCount: o._count.items,
          items: o.items.map((i) => ({
            iwasku: i.iwasku,
            name: productMap.get(i.iwasku)?.name ?? null,
            fnsku: productMap.get(i.iwasku)?.fnsku ?? null,
            quantity: i.quantity,
          })),
          hasShippingLabel: o.labels.length > 0,
          createdAt: o.createdAt,
          shippedAt: o.shippedAt,
        })),
        counts,
      },
    });
  }
);

export const POST = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Sipariş oluşturulamadı' },
  async ({ request, params }) => {
    const { code } = params;
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
    const parsed = CreateOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { orderType, marketplaceCode, orderNumber, description, addressNote, items } = parsed.data;

    // Marketplace edit yetkisi: yalnız SINGLE (müşteri siparişi). FBA_PICKUP
    // koli-bazlı depo çıkışı; hedef (Amazon US/Citi, CG_DEPO) bir satış
    // pazaryeri değil → createOutbound shelf rolü yeterli, marketplace-edit aranmaz.
    if (orderType === 'SINGLE') {
      const mpAccess = await getMarketplaceAccess(auth.user.id, auth.user.role);
      if (!canEditMarketplace(mpAccess, marketplaceCode)) {
        return NextResponse.json(
          { success: false, error: `${marketplaceCode} pazaryerinde sipariş yaratma yetkiniz yok` },
          { status: 403 }
        );
      }
    }

    if (orderType === 'SINGLE' && (!items || items.length === 0)) {
      return NextResponse.json(
        { success: false, error: 'En az 1 ürün satırı girin' },
        { status: 400 }
      );
    }

    // Stok kuralı (SINGLE): kalem ancak doğru US deposundan girilebilir.
    // Fairfield (SHOWROOM) önceliği — yanlış depodan giriş veya hiçbir yerde
    // olmayan ürün bloklanır. (FBA_PICKUP koli-bazlı, detayda kontrol edilir.)
    if (orderType === 'SINGLE' && items && items.length > 0) {
      const qtyByIwasku = new Map<string, number>();
      for (const it of items) {
        qtyByIwasku.set(it.iwasku, (qtyByIwasku.get(it.iwasku) ?? 0) + it.quantity);
      }
      const avail = await getUsAvailability([...qtyByIwasku.keys()], { subtractPendingDraft: true });
      const problems: string[] = [];
      for (const [iwasku, qty] of qtyByIwasku) {
        const a = avail.get(iwasku) ?? { NJ: 0, SHOWROOM: 0 };
        const msg = outboundBlockMessage(upperCode as UsWarehouse, iwasku, qty, a);
        if (msg) problems.push(msg);
      }
      if (problems.length > 0) {
        return NextResponse.json(
          { success: false, error: problems.join('\n') },
          { status: 400 }
        );
      }
    }

    // Aynı (warehouse, marketplace, orderNumber) zaten DRAFT/SHIPPED ise hata
    const dup = await prisma.outboundOrder.findUnique({
      where: {
        warehouseCode_marketplaceCode_orderNumber: {
          warehouseCode: upperCode,
          marketplaceCode,
          orderNumber,
        },
      },
    });
    if (dup) {
      return NextResponse.json(
        { success: false, error: `Bu marketplace + sipariş no zaten var (status: ${dup.status})` },
        { status: 409 }
      );
    }

    // Çift kayıt guard'ı (SINGLE müşteri siparişi): aynı sipariş başka numara/kaynakla
    // (ör. Wisersell otomatik orderNumber=51199, channelOrderNumber=S_IWAUS22055) zaten
    // girilmiş mi? FBA_PICKUP iç çıkış olduğundan kapsam dışı.
    if (orderType === 'SINGLE') {
      const channelDup = await findChannelDuplicate(orderNumber);
      if (channelDup) {
        return NextResponse.json({ success: false, error: duplicateMessage(channelDup) }, { status: 409 });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.create({
        data: {
          warehouseCode: upperCode,
          orderType,
          marketplaceCode,
          orderNumber,
          channelOrderNumber: orderType === 'SINGLE' ? orderNumber : null,
          description: description ?? null,
          addressNote: addressNote ?? null,
          status: 'DRAFT',
          createdById: auth.user.id,
        },
      });

      if (items && items.length > 0) {
        await tx.outboundOrderItem.createMany({
          data: items.map((it) => ({
            outboundOrderId: order.id,
            iwasku: it.iwasku,
            quantity: it.quantity,
          })),
        });
      }

      return order;
    });

    return createdResponse(created);
  }
);
