/**
 * POST /api/depolar/[code]/adet-duzelt
 * Tekil ürün (ShelfStock) veya koli (ShelfBox) adetini doğrudan düzelt — ADMIN'e özel.
 * Sayım flow'una alternatif hızlı düzeltme: yanlış giriş, sistem-fiziksel uyumsuzluğu, vb.
 * Audit: ShelfMovement(type=ADJUSTMENT, refType=MANUAL_EDIT, quantity=diff).
 *
 * Validasyon:
 *   - newQuantity >= 0
 *   - newQuantity >= reservedQty (rezerve altına düşemez)
 *   - reason en az 3 karakter
 *
 * Body:
 *   { type: 'STOCK', shelfStockId: string, newQuantity: number, reason: string }
 *   { type: 'BOX',   shelfBoxId: string,   newQuantity: number, reason: string }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BoxStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';
import { lockShelfStockById, lockShelfBoxById } from '@/lib/wms/lockedStock';

const Schema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('STOCK'),
    shelfStockId: z.string().trim().min(1),
    newQuantity: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    type: z.literal('BOX'),
    shelfBoxId: z.string().trim().min(1),
    newQuantity: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(500),
  }),
]);

export const POST = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Adet düzeltme başarısız' },
  async ({ request, params }) => {
    const { code } = params;
    const upperCode = code.toUpperCase();

    if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
      return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
    }

    const auth = await requireShelfAction(request, upperCode, 'editStockQuantity');
    if (auth instanceof NextResponse) return auth;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
    }
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        if (parsed.data.type === 'STOCK') {
          // FOR UPDATE: eşzamanlı düzeltme stale oldQty'den yanlış diff yazmasın
          const stock = await lockShelfStockById(tx, parsed.data.shelfStockId);
          if (!stock || stock.warehouseCode !== upperCode) {
            throw new Error('Tekil stok bulunamadı');
          }
          if (parsed.data.newQuantity < stock.reservedQty) {
            throw new Error(
              `Yeni adet (${parsed.data.newQuantity}) rezerve (${stock.reservedQty}) altına düşemez.`
            );
          }
          const oldQty = stock.quantity;
          const diff = parsed.data.newQuantity - oldQty;
          if (diff === 0) {
            return {
              type: 'STOCK',
              iwasku: stock.iwasku,
              oldQty,
              newQty: oldQty,
              diff: 0,
              noop: true,
            };
          }
          await tx.shelfStock.update({
            where: { id: stock.id },
            data: { quantity: parsed.data.newQuantity },
          });
          await tx.shelfMovement.create({
            data: {
              warehouseCode: upperCode,
              type: 'ADJUSTMENT',
              toShelfId: stock.shelfId,
              iwasku: stock.iwasku,
              quantity: diff,
              refType: 'MANUAL_EDIT',
              refId: stock.id,
              userId: auth.user.id,
              notes: `Adet düzeltme (tekil): ${stock.iwasku} ${oldQty}→${parsed.data.newQuantity} — ${parsed.data.reason}`,
            },
          });
          return {
            type: 'STOCK',
            iwasku: stock.iwasku,
            oldQty,
            newQty: parsed.data.newQuantity,
            diff,
          };
        } else {
          // FOR UPDATE: eşzamanlı düzeltme stale oldQty'den yanlış diff yazmasın
          const box = await lockShelfBoxById(tx, parsed.data.shelfBoxId);
          if (!box || box.warehouseCode !== upperCode) {
            throw new Error('Koli bulunamadı');
          }
          if (parsed.data.newQuantity < box.reservedQty) {
            throw new Error(
              `Yeni adet (${parsed.data.newQuantity}) rezerve (${box.reservedQty}) altına düşemez.`
            );
          }
          const oldQty = box.quantity;
          const diff = parsed.data.newQuantity - oldQty;
          if (diff === 0) {
            return {
              type: 'BOX',
              iwasku: box.iwasku,
              boxNumber: box.boxNumber,
              oldQty,
              newQty: oldQty,
              diff: 0,
              noop: true,
            };
          }
          // Status: 0 → EMPTY, eski SEALED'da azalma varsa PARTIAL'a düşür, artış ise SEALED'a değiştirme (manuel).
          let newStatus: BoxStatus = box.status as BoxStatus;
          if (parsed.data.newQuantity === 0) {
            newStatus = 'EMPTY';
          } else if (box.status === 'SEALED' && diff < 0) {
            newStatus = 'PARTIAL';
          } else if (box.status === 'EMPTY' && parsed.data.newQuantity > 0) {
            newStatus = 'PARTIAL';
          }
          await tx.shelfBox.update({
            where: { id: box.id },
            data: { quantity: parsed.data.newQuantity, status: newStatus },
          });
          await tx.shelfMovement.create({
            data: {
              warehouseCode: upperCode,
              type: 'ADJUSTMENT',
              toShelfId: box.shelfId,
              iwasku: box.iwasku,
              quantity: diff,
              shelfBoxId: box.id,
              refType: 'MANUAL_EDIT',
              refId: box.id,
              userId: auth.user.id,
              notes: `Adet düzeltme (koli ${box.boxNumber}): ${box.iwasku} ${oldQty}→${parsed.data.newQuantity} — ${parsed.data.reason}`,
            },
          });
          return {
            type: 'BOX',
            iwasku: box.iwasku,
            boxNumber: box.boxNumber,
            oldQty,
            newQty: parsed.data.newQuantity,
            diff,
            newStatus,
          };
        }
      });
      return successResponse(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Adet düzeltme başarısız';
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }
  }
);
