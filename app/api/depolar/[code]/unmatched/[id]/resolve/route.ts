/**
 * POST /api/depolar/[code]/unmatched/[id]/resolve
 * Bir UnmatchedSeedRow satırını çözüp ShelfStock/ShelfBox'a aktarır.
 *
 * Body:
 *   { iwasku, resolutionType: 'SKU_MASTER'|'PRODUCTS', applyToAllSameLookup? }
 *
 * applyToAllSameLookup=true → aynı rawLookup'lı tüm PENDING satırları toplu resolve.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';
import type { Prisma } from '@prisma/client';

const ResolveSchema = z.object({
  iwasku: z.string().trim().min(1),
  resolutionType: z.enum(['SKU_MASTER', 'PRODUCTS']),
  applyToAllSameLookup: z.boolean().optional(),
});

type Tx = Prisma.TransactionClient;

const DESTINATION_TAB: Record<string, string> = {
  ANKARA: 'TR',
  NJ: 'US',
  SHOWROOM: 'US_SHOWROOM',
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string; id: string }> }
) {
  const { code, id } = await context.params;
  const upperCode = code.toUpperCase();

  if (!ALL_WAREHOUSES.includes(upperCode as typeof ALL_WAREHOUSES[number])) {
    return NextResponse.json({ success: false, error: 'Bilinmeyen depo' }, { status: 404 });
  }

  const auth = await requireShelfAction(request, upperCode, 'resolveUnmatched');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = ResolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { iwasku, resolutionType, applyToAllSameLookup } = parsed.data;

  // iwasku verify (sku_master.iwasku veya products.product_sku)
  const verifyRows = (await queryProductDb(
    `SELECT 1 AS x FROM sku_master WHERE iwasku=$1
     UNION ALL
     SELECT 1 AS x FROM products WHERE product_sku=$1
     LIMIT 1`,
    [iwasku]
  )) as Array<{ x: number }>;
  if (verifyRows.length === 0) {
    return NextResponse.json(
      { success: false, error: `iwasku "${iwasku}" sistemde bulunamadı (sku_master ve products'ta yok)` },
      { status: 400 }
    );
  }

  // FNSKU lookup (opsiyonel)
  let fnsku: string | null = null;
  try {
    const fnskuRows = (await queryProductDb(
      `SELECT fnsku FROM sku_master WHERE iwasku=$1 AND fnsku IS NOT NULL LIMIT 1`,
      [iwasku]
    )) as Array<{ fnsku: string }>;
    fnsku = fnskuRows[0]?.fnsku ?? null;
  } catch { /* noop */ }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.unmatchedSeedRow.findUnique({ where: { id } });
      if (!target) throw new Error('Eşleşmeyen kayıt bulunamadı');
      if (target.warehouseCode !== upperCode) throw new Error('Kayıt bu depoya ait değil');
      if (target.status !== 'PENDING') throw new Error('Bu kayıt zaten çözülmüş veya atlanmış');

      // Toplu mod: aynı rawLookup için tüm PENDING'leri al
      const targets = applyToAllSameLookup
        ? await tx.unmatchedSeedRow.findMany({
            where: {
              warehouseCode: upperCode,
              rawLookup: target.rawLookup,
              status: 'PENDING',
            },
          })
        : [target];

      let resolvedCount = 0;
      let stocksCreated = 0;
      let boxesCreated = 0;

      for (const row of targets) {
        await resolveRow(tx, row, iwasku, fnsku, resolutionType, auth.user.id, upperCode);
        if (row.boxNumber) boxesCreated++;
        else stocksCreated++;
        resolvedCount++;
      }

      return { resolvedCount, stocksCreated, boxesCreated, iwasku };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Çözme başarısız';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

async function resolveRow(
  tx: Tx,
  row: {
    id: string; warehouseCode: string; shelfCode: string; boxNumber: string | null;
    quantity: number; description: string | null; rawLookup: string;
  },
  iwasku: string,
  fnsku: string | null,
  resolutionType: 'SKU_MASTER' | 'PRODUCTS',
  userId: string,
  warehouseCode: string
) {
  // Hedef rafı bul (yoksa yarat — seed sırasında raf upsert edilmişti, ama defansif)
  let shelf = await tx.shelf.findUnique({
    where: { warehouseCode_code: { warehouseCode, code: row.shelfCode } },
  });
  if (!shelf) {
    shelf = await tx.shelf.create({
      data: { warehouseCode, code: row.shelfCode, shelfType: 'NORMAL' },
    });
  }

  if (row.boxNumber) {
    // Koli olarak ekle — synthetic Shipment "Manuel Giriş" altına ShipmentBox + ShelfBox
    const syntheticName = `Manuel Giriş — ${warehouseCode}`;
    const destinationTab = DESTINATION_TAB[warehouseCode] ?? 'TR';
    let shipment = await tx.shipment.findFirst({
      where: { name: syntheticName, destinationTab },
    });
    if (!shipment) {
      shipment = await tx.shipment.create({
        data: {
          name: syntheticName,
          destinationTab,
          shippingMethod: 'manual',
          status: 'DELIVERED',
          notes: 'Sevkiyat-dışı manuel koli girişlerinin kapsayıcı kaydı.',
        },
      });
    }

    // Aynı boxNumber zaten ShipmentBox'ta var mı? Varsa boxId'yi yeniden kullan.
    let shipmentBox = await tx.shipmentBox.findFirst({
      where: { boxNumber: row.boxNumber },
    });
    if (!shipmentBox) {
      shipmentBox = await tx.shipmentBox.create({
        data: {
          shipmentId: shipment.id,
          boxNumber: row.boxNumber,
          iwasku,
          fnsku,
          marketplaceCode: null,
          destination: 'DEPO',
          quantity: row.quantity,
        },
      });
    }

    // ShelfBox eğer varsa update, yoksa create (idempotency)
    const existingShelfBox = await tx.shelfBox.findFirst({
      where: { warehouseCode, boxNumber: row.boxNumber },
    });
    let shelfBox;
    if (existingShelfBox) {
      shelfBox = await tx.shelfBox.update({
        where: { id: existingShelfBox.id },
        data: {
          shelfId: shelf.id,
          shipmentBoxId: shipmentBox.id,
          iwasku,
          fnsku,
          quantity: row.quantity,
          status: 'SEALED',
        },
      });
    } else {
      shelfBox = await tx.shelfBox.create({
        data: {
          warehouseCode,
          shelfId: shelf.id,
          shipmentBoxId: shipmentBox.id,
          boxNumber: row.boxNumber,
          iwasku,
          fnsku,
          marketplaceCode: null,
          destination: 'DEPO',
          quantity: row.quantity,
          status: 'SEALED',
        },
      });
    }

    await tx.shelfMovement.create({
      data: {
        warehouseCode,
        type: 'INBOUND_MANUAL',
        toShelfId: shelf.id,
        iwasku,
        quantity: row.quantity,
        shelfBoxId: shelfBox.id,
        refType: 'UNMATCHED_RESOLVE',
        refId: row.id,
        userId,
        notes: `Eşleşmeyen çözüldü: "${row.rawLookup}" → ${iwasku} (koli ${row.boxNumber}, ${row.description ?? '-'})`,
      },
    });
  } else {
    // ShelfStock olarak ekle (upsert)
    const existing = await tx.shelfStock.findUnique({
      where: { shelfId_iwasku: { shelfId: shelf.id, iwasku } },
    });
    if (existing) {
      await tx.shelfStock.update({
        where: { id: existing.id },
        data: { quantity: { increment: row.quantity } },
      });
    } else {
      await tx.shelfStock.create({
        data: { warehouseCode, shelfId: shelf.id, iwasku, quantity: row.quantity },
      });
    }

    await tx.shelfMovement.create({
      data: {
        warehouseCode,
        type: 'INBOUND_MANUAL',
        toShelfId: shelf.id,
        iwasku,
        quantity: row.quantity,
        refType: 'UNMATCHED_RESOLVE',
        refId: row.id,
        userId,
        notes: `Eşleşmeyen çözüldü: "${row.rawLookup}" → ${iwasku} (${row.description ?? '-'})`,
      },
    });
  }

  // UnmatchedSeedRow status RESOLVED
  await tx.unmatchedSeedRow.update({
    where: { id: row.id },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedById: userId,
      resolvedIwasku: iwasku,
      resolutionType,
    },
  });
}
