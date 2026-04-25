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

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

const AddItemSchema = z
  .object({
    shelfId: z.string().optional(),
    shelfBoxId: z.string().optional(),
    quantity: z.number().int().positive(),
    iwasku: z.string().optional(),
  })
  .refine((d) => d.shelfId || d.shelfBoxId, { message: 'shelfId veya shelfBoxId verilmeli' });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id } = await context.params;
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
        const box = await tx.shelfBox.findUnique({ where: { id: shelfBoxId } });
        if (!box) throw new Error('Koli bulunamadı');
        if (box.warehouseCode !== upperCode) throw new Error('Koli bu depoya ait değil');
        if (box.status === 'EMPTY') throw new Error('Boş koli kullanılamaz');
        const available = box.quantity - box.reservedQty;
        if (quantity > available) {
          throw new Error(`Koliden alınabilir: ${available} (rezerve: ${box.reservedQty})`);
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
        const stock = await tx.shelfStock.findFirst({
          where: { shelfId, warehouseCode: upperCode },
        });
        // Stock yoksa: parsed.data.iwasku ile spesifik bul
        const target = stock || (parsed.data.iwasku
          ? await tx.shelfStock.findUnique({
              where: { shelfId_iwasku: { shelfId, iwasku: parsed.data.iwasku } },
            })
          : null);
        if (!target) throw new Error('Raf stoğu bulunamadı');
        const available = target.quantity - target.reservedQty;
        if (quantity > available) {
          throw new Error(`Raftan alınabilir: ${available} (rezerve: ${target.reservedQty})`);
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

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Kalem eklenemedi';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id } = await context.params;
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
