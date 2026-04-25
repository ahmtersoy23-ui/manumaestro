/**
 * POST /api/depolar/[code]/koli/[boxId]/open
 * Koliyi tamamen aç: içerik aynı raftaki ShelfStock'a aktarılır,
 * koli status=EMPTY ve quantity=0 olur. Audit için ShelfBox satırı korunur.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; boxId: string }> }
) {
  const { code, boxId } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'openBox');
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const box = await tx.shelfBox.findUnique({ where: { id: boxId } });
      if (!box) throw new Error('Koli bulunamadı');
      if (box.warehouseCode !== upperCode) throw new Error('Koli bu depoya ait değil');
      if (box.status === 'EMPTY') throw new Error('Koli zaten boş');
      if (box.reservedQty > 0) throw new Error('Rezerve edilmiş koli açılamaz');

      const moveQty = box.quantity;

      // ShelfStock upsert (aynı raftaki aynı SKU)
      const existing = await tx.shelfStock.findUnique({
        where: { shelfId_iwasku: { shelfId: box.shelfId, iwasku: box.iwasku } },
      });
      if (existing) {
        await tx.shelfStock.update({
          where: { id: existing.id },
          data: { quantity: { increment: moveQty } },
        });
      } else {
        await tx.shelfStock.create({
          data: {
            warehouseCode: upperCode,
            shelfId: box.shelfId,
            iwasku: box.iwasku,
            quantity: moveQty,
          },
        });
      }

      // Koli boşalt — kayıt audit için duruyor
      await tx.shelfBox.update({
        where: { id: box.id },
        data: { quantity: 0, status: 'EMPTY' },
      });

      const movement = await tx.shelfMovement.create({
        data: {
          warehouseCode: upperCode,
          type: 'BOX_OPEN',
          fromShelfId: box.shelfId,
          toShelfId: box.shelfId,
          iwasku: box.iwasku,
          quantity: moveQty,
          shelfBoxId: box.id,
          refType: 'BOX_OPEN',
          userId: auth.user.id,
          notes: `Koli ${box.boxNumber} açıldı (${moveQty} adet ShelfStock'a aktarıldı)`,
        },
      });

      return { movementId: movement.id, boxNumber: box.boxNumber, transferred: moveQty };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Koli açılamadı';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
