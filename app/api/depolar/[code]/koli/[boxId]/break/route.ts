/**
 * POST /api/depolar/[code]/koli/[boxId]/break
 * Koliden kısmi miktar al: ShelfStock'a aktar, koli quantity azalır,
 * status SEALED → PARTIAL veya quantity 0 olursa EMPTY.
 *
 * Body: { quantity: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

const BreakSchema = z.object({
  quantity: z.number().int().positive(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; boxId: string }> }
) {
  const { code, boxId } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'breakBox');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = BreakSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { quantity } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const box = await tx.shelfBox.findUnique({ where: { id: boxId } });
      if (!box) throw new Error('Koli bulunamadı');
      if (box.warehouseCode !== upperCode) throw new Error('Koli bu depoya ait değil');
      if (box.status === 'EMPTY') throw new Error('Koli zaten boş');
      const available = box.quantity - box.reservedQty;
      if (quantity > available) {
        throw new Error(`Koliden alınabilir: ${available} (rezerve: ${box.reservedQty})`);
      }

      // ShelfStock upsert (aynı raftaki aynı SKU)
      const existing = await tx.shelfStock.findUnique({
        where: { shelfId_iwasku: { shelfId: box.shelfId, iwasku: box.iwasku } },
      });
      if (existing) {
        await tx.shelfStock.update({
          where: { id: existing.id },
          data: { quantity: { increment: quantity } },
        });
      } else {
        await tx.shelfStock.create({
          data: {
            warehouseCode: upperCode,
            shelfId: box.shelfId,
            iwasku: box.iwasku,
            quantity,
          },
        });
      }

      // Koli quantity azalt + status güncelle
      const newQty = box.quantity - quantity;
      const newStatus = newQty === 0 ? 'EMPTY' : 'PARTIAL';
      await tx.shelfBox.update({
        where: { id: box.id },
        data: { quantity: newQty, status: newStatus },
      });

      const movement = await tx.shelfMovement.create({
        data: {
          warehouseCode: upperCode,
          type: 'BOX_BREAK',
          fromShelfId: box.shelfId,
          toShelfId: box.shelfId,
          iwasku: box.iwasku,
          quantity,
          shelfBoxId: box.id,
          refType: 'BOX_BREAK',
          userId: auth.user.id,
          notes: `Koli ${box.boxNumber} parçalandı: ${quantity} adet alındı (kalan ${newQty})`,
        },
      });

      return {
        movementId: movement.id,
        boxNumber: box.boxNumber,
        taken: quantity,
        remaining: newQty,
        status: newStatus,
      };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Koli parçalanamadı';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
