/**
 * POST /api/depolar/[code]/sil
 * Tekil ürün (ShelfStock) veya koli (ShelfBox) sil — admin'e özel.
 * Audit: ShelfMovement(type=ADJUSTMENT, refType=DELETE, notes='Silindi: <reason>').
 *
 * Reservedy>0 ise blokla (rezerve sipariş bağlı, önce iptal/sevk gerekir).
 *
 * Body:
 *   { type: 'STOCK', shelfStockId: string, reason: string }
 *   { type: 'BOX',   shelfBoxId: string,   reason: string }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const DeleteSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('STOCK'),
    shelfStockId: z.string().trim().min(1),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    type: z.literal('BOX'),
    shelfBoxId: z.string().trim().min(1),
    reason: z.string().trim().min(3).max(500),
  }),
]);

export const POST = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Silme başarısız' },
  async ({ request, params }) => {
    const { code } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }

    const auth = await requireShelfAction(request, upperCode, 'deleteStock');
    if (auth instanceof NextResponse) return auth;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
    }
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        if (parsed.data.type === 'STOCK') {
          const stock = await tx.shelfStock.findUnique({
            where: { id: parsed.data.shelfStockId },
          });
          if (!stock || stock.warehouseCode !== upperCode) {
            throw new Error('Tekil stok bulunamadı');
          }
          if (stock.reservedQty > 0) {
            throw new Error(
              `Rezerve var (${stock.reservedQty}). Önce sipariş iptal/sevk edilmeli.`
            );
          }
          const removedQty = stock.quantity;
          await tx.shelfStock.delete({ where: { id: stock.id } });
          await tx.shelfMovement.create({
            data: {
              warehouseCode: upperCode,
              type: 'ADJUSTMENT',
              fromShelfId: stock.shelfId,
              iwasku: stock.iwasku,
              quantity: removedQty,
              refType: 'DELETE',
              refId: stock.id,
              userId: auth.user.id,
              notes: `Silindi (tekil): ${stock.iwasku} ×${removedQty} — ${parsed.data.reason}`,
            },
          });
          return { type: 'STOCK', removedQty, iwasku: stock.iwasku };
        } else {
          const box = await tx.shelfBox.findUnique({
            where: { id: parsed.data.shelfBoxId },
          });
          if (!box || box.warehouseCode !== upperCode) {
            throw new Error('Koli bulunamadı');
          }
          if (box.reservedQty > 0) {
            throw new Error(
              `Rezerve var (${box.reservedQty}). Önce sipariş iptal/sevk edilmeli.`
            );
          }
          const removedQty = box.quantity;
          await tx.shelfBox.delete({ where: { id: box.id } });
          await tx.shelfMovement.create({
            data: {
              warehouseCode: upperCode,
              type: 'ADJUSTMENT',
              fromShelfId: box.shelfId,
              iwasku: box.iwasku,
              quantity: removedQty,
              shelfBoxId: box.id,
              refType: 'DELETE',
              refId: box.id,
              userId: auth.user.id,
              notes: `Silindi (koli ${box.boxNumber}): ${box.iwasku} ×${removedQty} — ${parsed.data.reason}`,
            },
          });
          return { type: 'BOX', removedQty, iwasku: box.iwasku, boxNumber: box.boxNumber };
        }
      });
      return successResponse(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Silme başarısız';
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }
  }
);
