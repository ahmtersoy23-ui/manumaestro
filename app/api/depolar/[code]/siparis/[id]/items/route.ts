/**
 * POST   /api/depolar/[code]/siparis/[id]/items — kalem ekle (rezerve eder)
 * DELETE /api/depolar/[code]/siparis/[id]/items?itemId=... — kalem sil (rezerve serbest)
 *
 * SINGLE: shelfId VEYA shelfBoxId belirtilir
 *   - shelfId  → ShelfStock'tan rezerve, quantity belirtilir
 *   - shelfBoxId (kısmi) → ShelfBox'tan rezerve, kısmi miktar (status PARTIAL'a izin)
 *   - shelfBoxId (full)  → ShelfBox'tan rezerve, tam koli
 *
 * FBA_PICKUP: shelfBoxId zorunlu, tam koli (kısmi yok), quantity = box.quantity
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import {
  lockShelfBoxById,
  lockShelfStockByPair,
  NegativeInventoryError,
} from '@/lib/wms/lockedStock';
import { withRoute } from '@/lib/api/withRoute';
import { createdResponse } from '@/lib/api/response';

const AddItemSchema = z
  .object({
    shelfId: z.string().optional(),
    shelfBoxId: z.string().optional(),
    quantity: z.number().int().positive(),
    iwasku: z.string().optional(),
  })
  .refine((d) => d.shelfId || d.shelfBoxId, { message: 'shelfId veya shelfBoxId verilmeli' });

export const POST = withRoute<{ code: string; id: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Kalem eklenemedi' },
  async ({ request, params }) => {
    const { code, id } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }
    const auth = await requireShelfAction(request, upperCode, 'createOutbound');
    if (auth instanceof NextResponse) return auth;

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
    }
    const parsed = AddItemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { shelfId, shelfBoxId, quantity } = parsed.data;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const order = await tx.outboundOrder.findUnique({ where: { id } });
        if (!order || order.warehouseCode !== upperCode) throw new Error('Sipariş bulunamadı');
        if (order.status !== 'DRAFT') throw new Error('Sadece DRAFT siparişlere kalem eklenir');

        let resolvedShelfId: string | null = null;
        let resolvedBoxId: string | null = null;
        let resolvedIwasku: string;

        if (shelfBoxId) {
          const box = await lockShelfBoxById(tx, shelfBoxId);
          if (!box) throw new Error('Koli bulunamadı');
          if (box.warehouseCode !== upperCode) throw new Error('Koli bu depoya ait değil');
          if (box.status === 'EMPTY') throw new Error('Boş koli kullanılamaz');
          const available = box.quantity - box.reservedQty;
          if (quantity > available) {
            throw new NegativeInventoryError(
              `Koli ${box.boxNumber}: alınabilir ${available} (rezerve ${box.reservedQty})`
            );
          }
          if (order.orderType === 'FBA_PICKUP' && quantity !== box.quantity) {
            throw new Error('FBA_PICKUP modunda tam koli alınmalı (kısmi yok)');
          }

          await tx.shelfBox.update({
            where: { id: box.id },
            data: { reservedQty: { increment: quantity } },
          });

          resolvedBoxId = box.id;
          resolvedIwasku = box.iwasku;
        } else if (shelfId) {
          // shelfId + iwasku kombinasyonu zorunlu — generic findFirst güvensiz
          const targetIwasku = parsed.data.iwasku;
          if (!targetIwasku) {
            throw new Error('shelfId verildiğinde iwasku da verilmeli');
          }
          const target = await lockShelfStockByPair(tx, shelfId, targetIwasku);
          if (!target) throw new Error('Raf stoğu bulunamadı');
          if (target.warehouseCode !== upperCode) throw new Error('Stok bu depoya ait değil');
          const available = target.quantity - target.reservedQty;
          if (quantity > available) {
            throw new NegativeInventoryError(
              `Raf stoğu ${target.iwasku}: alınabilir ${available} (rezerve ${target.reservedQty})`
            );
          }

          await tx.shelfStock.update({
            where: { id: target.id },
            data: { reservedQty: { increment: quantity } },
          });

          resolvedShelfId = target.shelfId;
          resolvedIwasku = target.iwasku;
        } else {
          throw new Error('shelfId veya shelfBoxId verilmeli');
        }

        const item = await tx.outboundOrderItem.create({
          data: {
            outboundOrderId: order.id,
            iwasku: resolvedIwasku,
            quantity,
            shelfId: resolvedShelfId,
            shelfBoxId: resolvedBoxId,
          },
        });

        return item;
      });

      return createdResponse(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Kalem eklenemedi';
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }
  }
);

export const DELETE = withRoute<{ code: string; id: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Kalem silinemedi' },
  async ({ request, params }) => {
    const { code, id } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }
    const auth = await requireShelfAction(request, upperCode, 'createOutbound');
    if (auth instanceof NextResponse) return auth;

    const itemId = new URL(request.url).searchParams.get('itemId');
    if (!itemId) {
      return NextResponse.json({ success: false, error: 'itemId gerekli' }, { status: 400 });
    }

    try {
      await prisma.$transaction(async (tx) => {
        const item = await tx.outboundOrderItem.findUnique({ where: { id: itemId } });
        if (!item) throw new Error('Kalem bulunamadı');
        const order = await tx.outboundOrder.findUnique({ where: { id: item.outboundOrderId } });
        if (!order || order.id !== id || order.warehouseCode !== upperCode) {
          throw new Error('Kalem bu siparişe ait değil');
        }
        if (order.status !== 'DRAFT') throw new Error('Sadece DRAFT siparişlerden kalem silinir');

        // Rezerveyi geri al
        if (item.shelfBoxId) {
          await tx.shelfBox.update({
            where: { id: item.shelfBoxId },
            data: { reservedQty: { decrement: item.quantity } },
          });
        } else if (item.shelfId) {
          const stock = await tx.shelfStock.findUnique({
            where: { shelfId_iwasku: { shelfId: item.shelfId, iwasku: item.iwasku } },
          });
          if (stock) {
            await tx.shelfStock.update({
              where: { id: stock.id },
              data: { reservedQty: { decrement: item.quantity } },
            });
          }
        }

        await tx.outboundOrderItem.delete({ where: { id: itemId } });
      });

      return NextResponse.json({ success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Kalem silinemedi';
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }
  }
);
