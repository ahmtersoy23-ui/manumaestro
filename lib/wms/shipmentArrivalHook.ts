/**
 * Sevkiyat varış hook'u — Shipment.status DELIVERED'a geçince
 * sevkiyatın boxes'ı hedef deponun POOL rafına ShelfBox(SEALED) olarak yazar.
 *
 * destinationTab → warehouseCode mapping:
 *   US → NJ
 *   US_SHOWROOM → SHOWROOM
 *   diğer (UK/EU/NL/AU/ZA) → raf yansıması atlanır (eski akış aynı)
 *
 * Idempotent: aynı shipmentBoxId'li ShelfBox zaten varsa atlar.
 * Tüm operasyon çağrıyı yapan transaction'ın içinde olmalı.
 */

import type { Prisma } from '@prisma/client';

const DESTINATION_TO_WAREHOUSE: Record<string, string> = {
  US: 'NJ',
  US_SHOWROOM: 'SHOWROOM',
};

export interface ArrivalResult {
  warehouseCode: string | null;
  boxesCreated: number;
  boxesSkipped: number;
}

export async function processShipmentArrival(
  tx: Prisma.TransactionClient,
  shipmentId: string,
  userId: string
): Promise<ArrivalResult> {
  const shipment = await tx.shipment.findUnique({
    where: { id: shipmentId },
    include: { boxes: true },
  });
  if (!shipment) throw new Error('Sevkiyat bulunamadı');

  const warehouseCode = DESTINATION_TO_WAREHOUSE[shipment.destinationTab];
  if (!warehouseCode) {
    // Mapping yok → eski akış (raf yansıması atlanır)
    return { warehouseCode: null, boxesCreated: 0, boxesSkipped: shipment.boxes.length };
  }

  // Depo + POOL rafı zorunlu
  const warehouse = await tx.warehouse.findUnique({ where: { code: warehouseCode } });
  if (!warehouse || !warehouse.isActive) {
    throw new Error(`Hedef depo (${warehouseCode}) yok veya pasif — DELIVERED bloklandı`);
  }
  const pool = await tx.shelf.findFirst({
    where: { warehouseCode, shelfType: 'POOL', isActive: true },
  });
  if (!pool) {
    throw new Error(`${warehouseCode} deposunda POOL raf yok — önce yaratın`);
  }

  let boxesCreated = 0;
  let boxesSkipped = 0;

  for (const box of shipment.boxes) {
    if (!box.iwasku) {
      // iwasku yoksa raf yansıması anlamsız (denormalize edilmiş veri)
      boxesSkipped++;
      continue;
    }

    // Idempotency: aynı ShipmentBox referansı varsa atla
    const existing = await tx.shelfBox.findUnique({
      where: { shipmentBoxId: box.id },
    });
    if (existing) {
      boxesSkipped++;
      continue;
    }

    const shelfBox = await tx.shelfBox.create({
      data: {
        warehouseCode,
        shelfId: pool.id,
        shipmentBoxId: box.id,
        boxNumber: box.boxNumber,
        iwasku: box.iwasku,
        fnsku: box.fnsku,
        marketplaceCode: box.marketplaceCode,
        destination: box.destination,
        quantity: box.quantity,
        status: 'SEALED',
      },
    });

    await tx.shelfMovement.create({
      data: {
        warehouseCode,
        type: 'INBOUND_FROM_SHIPMENT',
        toShelfId: pool.id,
        iwasku: box.iwasku,
        quantity: box.quantity,
        shelfBoxId: shelfBox.id,
        refType: 'SHIPMENT',
        refId: shipmentId,
        userId,
        notes: `Sevkiyat ${shipment.name} varışı — koli ${box.boxNumber}`,
      },
    });

    boxesCreated++;
  }

  return { warehouseCode, boxesCreated, boxesSkipped };
}
