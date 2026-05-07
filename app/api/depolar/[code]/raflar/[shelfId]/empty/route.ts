/**
 * POST /api/depolar/[code]/raflar/[shelfId]/empty
 *
 * Rafın TÜM içeriğini (ShelfStock + ShelfBox satırları) hedef rafa taşır.
 * Tek transaction; rezerveli stok varsa tüm akış reddedilir.
 *
 * Body: { targetShelfId: string }
 *
 * Yetki: managePermissions (ADMIN). Riskli toplu aksiyon.
 *
 * Davranış:
 * - Aynı depo: hedef raf herhangi bir tip olabilir
 * - Cross-warehouse (NJ ↔ SHOWROOM): hedef raf POOL/TEMP olmalı
 * - Tüm ShelfStock satırları: hedefte aynı iwasku varsa qty artır (upsert),
 *   yoksa create. Kaynak kayıt silinir.
 * - Tüm ShelfBox satırları: warehouseCode + shelfId update (kayıt aynı kalır,
 *   sadece konum değişir).
 * - Her satır için ShelfMovement(TRANSFER veya CROSS_WAREHOUSE_TRANSFER) audit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

const Schema = z.object({
  targetShelfId: z.string().trim().min(1),
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

  // Rafı boşaltma kritik aksiyon — admin only (managePermissions sadece ADMIN'de true)
  const auth = await requireShelfAction(request, upperCode, 'managePermissions');
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

  // Kaynak raf
  const source = await prisma.shelf.findFirst({
    where: {
      warehouseCode: upperCode,
      OR: [{ id: shelfIdOrCode }, { code: decodeURIComponent(shelfIdOrCode) }],
    },
  });
  if (!source) {
    return NextResponse.json({ success: false, error: 'Kaynak raf bulunamadı' }, { status: 404 });
  }

  // Hedef raf — herhangi bir depoda
  const target = await prisma.shelf.findUnique({
    where: { id: parsed.data.targetShelfId },
  });
  if (!target || !target.isActive) {
    return NextResponse.json(
      { success: false, error: 'Hedef raf bulunamadı veya pasif' },
      { status: 404 }
    );
  }
  if (target.id === source.id) {
    return NextResponse.json(
      { success: false, error: 'Hedef ile kaynak raf aynı olamaz' },
      { status: 400 }
    );
  }

  const isCross = target.warehouseCode !== source.warehouseCode;
  if (isCross && target.shelfType !== 'POOL' && target.shelfType !== 'TEMP') {
    return NextResponse.json(
      { success: false, error: 'Cross-warehouse hedef yalnız POOL/TEMP raf olabilir' },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const stocks = await tx.shelfStock.findMany({ where: { shelfId: source.id } });
      const boxes = await tx.shelfBox.findMany({ where: { shelfId: source.id } });

      // Rezerve kontrolü
      const reservedStocks = stocks.filter((s) => s.reservedQty > 0);
      const reservedBoxes = boxes.filter((b) => b.reservedQty > 0);
      if (reservedStocks.length > 0 || reservedBoxes.length > 0) {
        const total = reservedStocks.length + reservedBoxes.length;
        throw new Error(
          `Rafta rezerve var (${total} kayıt) — boşaltmadan önce siparişler iptal/sevk edilmeli`
        );
      }

      const movementType = isCross ? 'CROSS_WAREHOUSE_TRANSFER' : 'TRANSFER';
      const refType = 'SHELF_EMPTY';

      // 1) ShelfStock satırlarını taşı
      for (const s of stocks) {
        // Hedefte aynı iwasku var mı?
        const existing = await tx.shelfStock.findUnique({
          where: { shelfId_iwasku: { shelfId: target.id, iwasku: s.iwasku } },
        });
        if (existing) {
          await tx.shelfStock.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + s.quantity },
          });
          await tx.shelfStock.delete({ where: { id: s.id } });
        } else {
          // Move: warehouseCode + shelfId güncelle
          await tx.shelfStock.update({
            where: { id: s.id },
            data: { warehouseCode: target.warehouseCode, shelfId: target.id },
          });
        }
        await tx.shelfMovement.create({
          data: {
            warehouseCode: source.warehouseCode,
            type: movementType,
            fromShelfId: source.id,
            toShelfId: target.id,
            iwasku: s.iwasku,
            quantity: s.quantity,
            refType,
            refId: source.id,
            userId: auth.user.id,
            notes: `Rafı boşalt: ${source.code} → ${target.code} (tekil ${s.iwasku} ×${s.quantity})`,
          },
        });
      }

      // 2) ShelfBox satırlarını taşı (status'a bakmaksızın hepsi)
      for (const b of boxes) {
        await tx.shelfBox.update({
          where: { id: b.id },
          data: { warehouseCode: target.warehouseCode, shelfId: target.id },
        });
        await tx.shelfMovement.create({
          data: {
            warehouseCode: source.warehouseCode,
            type: movementType,
            fromShelfId: source.id,
            toShelfId: target.id,
            iwasku: b.iwasku,
            quantity: b.quantity,
            shelfBoxId: b.id,
            refType,
            refId: source.id,
            userId: auth.user.id,
            notes: `Rafı boşalt: ${source.code} → ${target.code} (koli ${b.boxNumber})`,
          },
        });
      }

      return { stocksMoved: stocks.length, boxesMoved: boxes.length };
    });

    return NextResponse.json({
      success: true,
      data: {
        sourceCode: source.code,
        targetCode: target.code,
        targetWarehouse: target.warehouseCode,
        ...result,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Rafı boşaltma başarısız';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
