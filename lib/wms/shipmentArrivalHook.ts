/**
 * Sevkiyat varış hook'u — Shipment.status DELIVERED'a geçince
 * sevkiyatın boxes'ı KOLİ BAZINDA hedef deponun POOL rafına yansır.
 *
 * Hedef seçimi: destinationTab + ShipmentBox.destination kombinasyonu
 *   destinationTab='US' AND box.destination='SHOWROOM' → SHOWROOM POOL
 *   destinationTab='US' AND box.destination ∈ {FBA, DEPO} → NJ POOL
 *   diğer destinationTab (UK/EU/...) → raf yansıması atlanır (eski akış)
 *
 * Idempotent: aynı shipmentBoxId'li ShelfBox zaten varsa atlar.
 * Çağrıyı yapan transaction'ın içinde olmalı.
 */

import type { Prisma } from '@prisma/client';

export interface ArrivalResult {
  warehouseDistribution: Record<string, number>; // warehouseCode → boxes
  boxesCreated: number;
  boxesSkipped: number;
}

/**
 * Bir koli'nin gideceği depoyu belirler.
 * Mapping yoksa null döner (raf yansıması atlanır).
 */
function resolveTargetWarehouse(destinationTab: string, boxDestination: string): string | null {
  if (destinationTab === 'US') {
    if (boxDestination === 'SHOWROOM') return 'SHOWROOM';
    return 'NJ'; // FBA + DEPO → NJ
  }
  // Diğer destinasyonlar şimdilik raf takibinde değil
  return null;
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

  // POOL raf cache (depo başına bir kere fetch)
  const poolCache = new Map<string, string>(); // warehouseCode → poolId
  const getPool = async (warehouseCode: string): Promise<string> => {
    const cached = poolCache.get(warehouseCode);
    if (cached) return cached;
    const wh = await tx.warehouse.findUnique({ where: { code: warehouseCode } });
    if (!wh || !wh.isActive) {
      throw new Error(`Hedef depo (${warehouseCode}) yok veya pasif — DELIVERED bloklandı`);
    }
    const pool = await tx.shelf.findFirst({
      where: { warehouseCode, shelfType: 'POOL', isActive: true },
    });
    if (!pool) throw new Error(`${warehouseCode} deposunda POOL raf yok — önce yaratın`);
    poolCache.set(warehouseCode, pool.id);
    return pool.id;
  };

  const distribution: Record<string, number> = {};
  let boxesCreated = 0;
  let boxesSkipped = 0;

  for (const box of shipment.boxes) {
    const targetWh = resolveTargetWarehouse(shipment.destinationTab, box.destination);
    if (!targetWh) {
      boxesSkipped++;
      continue;
    }
    if (!box.iwasku) {
      // iwasku yoksa raf yansıması anlamsız (denormalize edilmiş veri eksik)
      boxesSkipped++;
      continue;
    }

    // Idempotency
    const existing = await tx.shelfBox.findUnique({
      where: { shipmentBoxId: box.id },
    });
    if (existing) {
      boxesSkipped++;
      continue;
    }

    const poolId = await getPool(targetWh);

    const shelfBox = await tx.shelfBox.create({
      data: {
        warehouseCode: targetWh,
        shelfId: poolId,
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
        warehouseCode: targetWh,
        type: 'INBOUND_FROM_SHIPMENT',
        toShelfId: poolId,
        iwasku: box.iwasku,
        quantity: box.quantity,
        shelfBoxId: shelfBox.id,
        refType: 'SHIPMENT',
        refId: shipmentId,
        userId,
        notes: `Sevkiyat ${shipment.name} varışı — koli ${box.boxNumber} (${box.destination})`,
      },
    });

    distribution[targetWh] = (distribution[targetWh] ?? 0) + 1;
    boxesCreated++;
  }

  return { warehouseDistribution: distribution, boxesCreated, boxesSkipped };
}
