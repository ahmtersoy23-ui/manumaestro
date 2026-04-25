/**
 * POST /api/depolar/[code]/koli
 * Sevkiyat-dışı manuel koli ekleme. Synthetic "Manuel Giriş — {warehouseCode}"
 * Shipment altına ShipmentBox yaratır + ShelfBox'a yazar + ShelfMovement log atar.
 *
 * destinationTab mapping:
 *   ANKARA → 'TR', NJ → 'US', SHOWROOM → 'US_SHOWROOM'
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { ALL_WAREHOUSES } from '@/lib/auth/shelfPermission';

const ManualBoxSchema = z.object({
  iwasku: z.string().trim().min(1),
  quantity: z.number().int().positive().max(100000),
  marketplaceCode: z.string().trim().min(1),
  destination: z.enum(['FBA', 'DEPO']).default('DEPO'),
  boxNumber: z.string().trim().max(50).optional(),
  targetShelfId: z.string().trim().optional(), // boş ise POOL
  notes: z.string().trim().max(500).optional(),
});

const DESTINATION_TAB: Record<string, string> = {
  ANKARA: 'TR',
  NJ: 'US',
  SHOWROOM: 'US_SHOWROOM',
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
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

  const parsed = ManualBoxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { iwasku, quantity, marketplaceCode, destination, boxNumber, targetShelfId, notes } = parsed.data;
  const destinationTab = DESTINATION_TAB[upperCode] ?? 'TR';

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

  // FNSKU lookup (sku_master) — opsiyonel, başarılı olursa kayda ekle
  let fnsku: string | null = null;
  try {
    const rows = (await queryProductDb(
      `SELECT fnsku FROM sku_master WHERE iwasku = $1 AND fnsku IS NOT NULL LIMIT 1`,
      [iwasku]
    )) as Array<{ fnsku: string }>;
    fnsku = rows[0]?.fnsku ?? null;
  } catch {
    // sku_master erişilemezse FNSKU null kalır — kritik değil
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Synthetic "Manuel Giriş" Shipment upsert (name + destinationTab natural key)
    const syntheticName = `Manuel Giriş — ${upperCode}`;
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

    // 2. boxNumber: kullanıcı verdiyse unique kontrolü, vermediyse otomatik MAN-{code}-{N}
    let finalBoxNumber: string;
    if (boxNumber) {
      const dup = await tx.shipmentBox.findFirst({
        where: { boxNumber },
        select: { id: true },
      });
      if (dup) throw new Error(`Koli numarası "${boxNumber}" zaten kullanımda`);
      finalBoxNumber = boxNumber;
    } else {
      const prefix = `MAN-${upperCode}-`;
      const last = await tx.shipmentBox.findFirst({
        where: { boxNumber: { startsWith: prefix } },
        orderBy: { boxNumber: 'desc' },
        select: { boxNumber: true },
      });
      const nextSeq = last
        ? Number(last.boxNumber.replace(prefix, '')) + 1
        : 1;
      finalBoxNumber = `${prefix}${String(nextSeq).padStart(3, '0')}`;
    }

    // 3. ShipmentBox kaydı
    const shipmentBox = await tx.shipmentBox.create({
      data: {
        shipmentId: shipment.id,
        boxNumber: finalBoxNumber,
        iwasku,
        fnsku,
        marketplaceCode,
        destination,
        quantity,
      },
    });

    // 4. ShelfBox kaydı (target rafa SEALED)
    const shelfBox = await tx.shelfBox.create({
      data: {
        warehouseCode: upperCode,
        shelfId: targetShelf!.id,
        shipmentBoxId: shipmentBox.id,
        boxNumber: finalBoxNumber,
        iwasku,
        fnsku,
        marketplaceCode,
        destination,
        quantity,
        status: 'SEALED',
      },
    });

    // 5. ShelfMovement log
    await tx.shelfMovement.create({
      data: {
        warehouseCode: upperCode,
        type: 'INBOUND_MANUAL',
        toShelfId: targetShelf!.id,
        iwasku,
        quantity,
        shelfBoxId: shelfBox.id,
        refType: 'MANUAL_BOX',
        refId: shipmentBox.id,
        userId: auth.user.id,
        notes: notes ?? `Manuel koli: ${finalBoxNumber}`,
      },
    });

    return { shipmentBox, shelfBox, shelf: targetShelf };
  });

  return NextResponse.json({
    success: true,
    data: {
      box: result.shelfBox,
      shelfCode: result.shelf!.code,
      boxNumber: result.shipmentBox.boxNumber,
    },
  }, { status: 201 });
}
