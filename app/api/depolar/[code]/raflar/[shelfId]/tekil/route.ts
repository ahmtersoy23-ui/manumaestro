/**
 * POST /api/depolar/[code]/raflar/[shelfId]/tekil
 * Sevkiyat-dışı manuel TEKİL (loose) ürün ekleme. Koli wrapper'ı yaratmaz.
 * ShelfStock upsert (aynı iwasku varsa qty artar) + ShelfMovement(INBOUND_MANUAL) log.
 *
 * shelfId hem gerçek UUID hem de raf kodu (URL friendly) olabilir.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

const LooseStockSchema = z.object({
  iwasku: z.string().trim().min(1),
  quantity: z.number().int().positive().max(100000),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; shelfId: string }> }
) {
  const { code, shelfId: shelfIdOrCode } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'addManualBox');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }

  const parsed = LooseStockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { iwasku, quantity, notes } = parsed.data;

  // Raf'ı ID veya code ile bul
  const shelf = await prisma.shelf.findFirst({
    where: {
      warehouseCode: upperCode,
      isActive: true,
      OR: [
        { id: shelfIdOrCode },
        { code: decodeURIComponent(shelfIdOrCode) },
      ],
    },
  });

  if (!shelf) {
    return NextResponse.json({ success: false, error: 'Raf bulunamadı' }, { status: 404 });
  }

  const result = await prisma.$transaction(async (tx) => {
    // ShelfStock upsert: aynı (shelfId, iwasku) varsa qty artır
    const stock = await tx.shelfStock.upsert({
      where: {
        shelfId_iwasku: { shelfId: shelf.id, iwasku },
      },
      create: {
        warehouseCode: upperCode,
        shelfId: shelf.id,
        iwasku,
        quantity,
        reservedQty: 0,
      },
      update: {
        quantity: { increment: quantity },
      },
    });

    const movement = await tx.shelfMovement.create({
      data: {
        warehouseCode: upperCode,
        type: 'INBOUND_MANUAL',
        toShelfId: shelf.id,
        iwasku,
        quantity,
        refType: 'MANUAL_LOOSE',
        refId: stock.id,
        userId: auth.user.id,
        notes: notes ?? `Manuel tekil: ${iwasku} × ${quantity}`,
      },
    });

    return { stock, movement };
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        shelfCode: shelf.code,
        iwasku,
        quantity,
        newQuantity: result.stock.quantity,
        movementId: result.movement.id,
      },
    },
    { status: 201 }
  );
}
