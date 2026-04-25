/**
 * POST /api/depolar/[code]/transfer
 * Raflar arası transfer — aynı depo veya cross-warehouse (NJ ↔ Showroom).
 *
 * Body:
 *   { source: { type: 'stock'|'box', id }, toShelfId, quantity? }
 *   - source.type='stock' → ShelfStock'tan tekil ürün, quantity zorunlu
 *   - source.type='box'   → ShelfBox tüm koli (kısmi yok); kısmiyse önce parçala
 *
 * Cross-warehouse kuralları:
 *   - Hedef raf farklı depodaysa: shelfType ∈ {POOL, TEMP} olmalı
 *   - Yetki: 'crossWarehouseTransfer' (aynı depo için 'transferStock')
 *   - ShelfBox aynı satır update olur (warehouseCode + shelfId değişir, shipmentBoxId korunur)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

const TransferSchema = z.object({
  source: z.object({
    type: z.enum(['stock', 'box']),
    id: z.string().min(1),
  }),
  toShelfId: z.string().min(1),
  quantity: z.number().int().positive().optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }

  const parsed = TransferSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { source, toShelfId, quantity, notes } = parsed.data;

  // Hedef raf
  const toShelf = await prisma.shelf.findFirst({
    where: { id: toShelfId, isActive: true },
  });
  if (!toShelf) {
    return NextResponse.json({ success: false, error: 'Hedef raf bulunamadı' }, { status: 404 });
  }

  const isCross = toShelf.warehouseCode !== upperCode;
  const action = isCross ? 'crossWarehouseTransfer' : 'transferStock';

  const auth = await requireShelfAction(request, upperCode, action);
  if (auth instanceof NextResponse) return auth;

  // Cross-warehouse → hedef raf POOL/TEMP zorunlu
  if (isCross && !['POOL', 'TEMP'].includes(toShelf.shelfType)) {
    return NextResponse.json(
      { success: false, error: 'Diğer depoya transfer için hedef raf POOL veya TEMP olmalı' },
      { status: 400 }
    );
  }

  try {
    if (source.type === 'stock') {
      const result = await transferStock(
        upperCode,
        source.id,
        toShelf,
        quantity ?? 0,
        auth.user.id,
        isCross,
        notes
      );
      return NextResponse.json({ success: true, data: result });
    } else {
      const result = await transferBox(
        upperCode,
        source.id,
        toShelf,
        auth.user.id,
        isCross,
        notes
      );
      return NextResponse.json({ success: true, data: result });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Transfer başarısız';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

async function transferStock(
  fromWarehouseCode: string,
  sourceStockId: string,
  toShelf: { id: string; warehouseCode: string },
  quantity: number,
  userId: string,
  isCross: boolean,
  notes?: string
) {
  if (quantity <= 0) throw new Error('Miktar pozitif olmalı');

  return prisma.$transaction(async (tx) => {
    const src = await tx.shelfStock.findUnique({
      where: { id: sourceStockId },
      include: { shelf: true },
    });
    if (!src) throw new Error('Kaynak stok bulunamadı');
    if (src.warehouseCode !== fromWarehouseCode) {
      throw new Error('Kaynak stok bu depoya ait değil');
    }
    if (src.shelfId === toShelf.id) {
      throw new Error('Aynı rafa transfer yapılamaz');
    }
    const available = src.quantity - src.reservedQty;
    if (quantity > available) {
      throw new Error(`Yetersiz stok: kullanılabilir ${available}`);
    }

    // Kaynaktan düş
    if (src.quantity === quantity) {
      await tx.shelfStock.delete({ where: { id: src.id } });
    } else {
      await tx.shelfStock.update({
        where: { id: src.id },
        data: { quantity: { decrement: quantity } },
      });
    }

    // Hedefe ekle (upsert)
    const targetWh = toShelf.warehouseCode;
    const existing = await tx.shelfStock.findUnique({
      where: { shelfId_iwasku: { shelfId: toShelf.id, iwasku: src.iwasku } },
    });
    if (existing) {
      await tx.shelfStock.update({
        where: { id: existing.id },
        data: { quantity: { increment: quantity } },
      });
    } else {
      await tx.shelfStock.create({
        data: {
          warehouseCode: targetWh,
          shelfId: toShelf.id,
          iwasku: src.iwasku,
          quantity,
        },
      });
    }

    // Movement log
    const movement = await tx.shelfMovement.create({
      data: {
        warehouseCode: fromWarehouseCode,
        type: isCross ? 'CROSS_WAREHOUSE_TRANSFER' : 'TRANSFER',
        fromShelfId: src.shelfId,
        toShelfId: toShelf.id,
        iwasku: src.iwasku,
        quantity,
        userId,
        notes:
          notes ??
          (isCross
            ? `Cross-warehouse: ${fromWarehouseCode} → ${targetWh}`
            : `Raflı transfer (${quantity})`),
      },
    });

    return { movementId: movement.id, fromShelfId: src.shelfId, toShelfId: toShelf.id, quantity };
  });
}

async function transferBox(
  fromWarehouseCode: string,
  sourceBoxId: string,
  toShelf: { id: string; warehouseCode: string },
  userId: string,
  isCross: boolean,
  notes?: string
) {
  return prisma.$transaction(async (tx) => {
    const box = await tx.shelfBox.findUnique({ where: { id: sourceBoxId } });
    if (!box) throw new Error('Kaynak koli bulunamadı');
    if (box.warehouseCode !== fromWarehouseCode) {
      throw new Error('Kaynak koli bu depoya ait değil');
    }
    if (box.shelfId === toShelf.id) {
      throw new Error('Aynı rafa transfer yapılamaz');
    }
    if (box.status === 'EMPTY') {
      throw new Error('Boş koli transfer edilemez');
    }
    if (box.reservedQty > 0) {
      throw new Error('Rezerve edilmiş koli transfer edilemez (önce rezerveyi serbest bırak)');
    }

    const fromShelfId = box.shelfId;

    // Aynı satır update — warehouseCode + shelfId değişir
    await tx.shelfBox.update({
      where: { id: box.id },
      data: { warehouseCode: toShelf.warehouseCode, shelfId: toShelf.id },
    });

    const movement = await tx.shelfMovement.create({
      data: {
        warehouseCode: fromWarehouseCode,
        type: isCross ? 'CROSS_WAREHOUSE_TRANSFER' : 'TRANSFER',
        fromShelfId,
        toShelfId: toShelf.id,
        iwasku: box.iwasku,
        quantity: box.quantity,
        shelfBoxId: box.id,
        userId,
        notes:
          notes ??
          (isCross
            ? `Cross-warehouse: koli ${box.boxNumber} (${fromWarehouseCode} → ${toShelf.warehouseCode})`
            : `Koli transfer: ${box.boxNumber}`),
      },
    });

    return {
      movementId: movement.id,
      fromShelfId,
      toShelfId: toShelf.id,
      boxNumber: box.boxNumber,
      quantity: box.quantity,
    };
  });
}
