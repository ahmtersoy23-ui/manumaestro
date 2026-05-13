/**
 * POST /api/depolar/[code]/tekil
 * Sevkiyat-dışı manuel TEKİL (loose) ürün ekleme. Koli wrapper'ı yaratmaz.
 * ShelfStock upsert (aynı iwasku varsa qty artar) + ShelfMovement(INBOUND_MANUAL) log.
 *
 * targetShelfId boşsa POOL'a düşer (Manuel Koli pattern'iyle simetrik).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { withRoute } from '@/lib/api/withRoute';
import { createdResponse } from '@/lib/api/response';

const LooseStockSchema = z.object({
  iwasku: z.string().trim().min(1),
  quantity: z.number().int().positive().max(100000),
  targetShelfId: z.string().trim().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const POST = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Tekil ürün eklenemedi' },
  async ({ request, params }) => {
    const { code } = params;
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

    const { iwasku, quantity, targetShelfId, notes } = parsed.data;

    // Hedef raf — belirtilmediyse POOL
    let targetShelf;
    if (targetShelfId) {
      targetShelf = await prisma.shelf.findFirst({
        where: { id: targetShelfId, warehouseCode: upperCode, isActive: true },
      });
      if (!targetShelf) {
        return NextResponse.json({ success: false, error: 'Hedef raf bulunamadı' }, { status: 404 });
      }
    } else {
      targetShelf = await prisma.shelf.findFirst({
        where: { warehouseCode: upperCode, shelfType: 'POOL', isActive: true },
      });
      if (!targetShelf) {
        return NextResponse.json(
          { success: false, error: `${upperCode} deposunda POOL raf yok` },
          { status: 400 }
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const stock = await tx.shelfStock.upsert({
        where: {
          shelfId_iwasku: { shelfId: targetShelf!.id, iwasku },
        },
        create: {
          warehouseCode: upperCode,
          shelfId: targetShelf!.id,
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
          toShelfId: targetShelf!.id,
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

    return createdResponse({
      shelfCode: targetShelf!.code,
      iwasku,
      quantity,
      newQuantity: result.stock.quantity,
      movementId: result.movement.id,
    });
  }
);
