/**
 * Sevkiyat varış hook'u — Shipment.status DELIVERED'a geçince
 * sevkiyatın boxes'ı KOLİ BAZINDA hedef deponun POOL rafına yansır.
 *
 * Hedef seçimi: destinationTab + ShipmentBox.destination kombinasyonu
 *   destinationTab='US' AND box.destination='SHOWROOM' → SHOWROOM POOL
 *   destinationTab='US' AND box.destination='DEPO'     → NJ POOL (Somerset)
 *   destinationTab='US' AND box.destination='FBA'      → atla (doğrudan kargoya teslim, depoya girmez)
 *   diğer destinationTab (UK/EU/...) → raf yansıması atlanır (eski akış)
 *
 * Ayrıca: "Fairfield Toplu Gönderim" konsolidasyon paletleri (ShipmentContainer,
 * US tab) varışta AÇILIP tekil ShelfStock olarak FAIRFIELD (SHOWROOM) POOL'una
 * patlar. Tüm satırlar Fairfield'a gider — palet=Fairfield kuralı, satırın
 * recommendedDestination'ına (NJ_DEPO/CG_DEPO) bakılmaz. Koli-listesi DEPO'dan
 * (Somerset/NJ) bilinçli olarak ayrı tutulur.
 *
 * Idempotent: ShipmentBox için shipmentBoxId'li ShelfBox; konteyner için
 * ShipmentContainer.arrivedAt damgası. Çağrıyı yapan transaction'ın içinde olmalı.
 */

import type { Prisma } from '@prisma/client';

export interface ArrivalResult {
  warehouseDistribution: Record<string, number>; // warehouseCode → boxes (+ konteyner adetleri)
  boxesCreated: number;
  boxesSkipped: number;
  containerLinesAdded: number;  // Fairfield'a patlatılan konsolidasyon satırı sayısı
  containerUnitsAdded: number;  // ...ve toplam adet
}

/**
 * Bir koli'nin gideceği depoyu belirler.
 * Mapping yoksa null döner (raf yansıması atlanır).
 * Export: birim test + ileride yeni destinationTab eklenince tablo görünür kalsın.
 */
export function resolveTargetWarehouse(destinationTab: string, boxDestination: string): string | null {
  if (destinationTab === 'US') {
    if (boxDestination === 'SHOWROOM') return 'SHOWROOM';
    if (boxDestination === 'DEPO') return 'NJ';
    // FBA koliler doğrudan kargoya teslim edilir, depoya hiç girmez
    return null;
  }
  if (destinationTab === 'EU') {
    if (boxDestination === 'DEPO' || boxDestination === 'NL') return 'NL';
    // FBA (Amazon EU) doğrudan Amazon inbound — depoya girmez
    return null;
  }
  // UK / CA / AU / ZA: şimdilik raf takibinde değil (FBA odaklı)
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

  // === Fairfield Toplu Gönderim (konsolidasyon paletleri) ===
  // Palet/koli AÇILIP tekil ShelfStock olarak Fairfield (SHOWROOM) POOL'una patlar.
  // Tüm satırlar Fairfield'a — palet=Fairfield kuralı (satırın recommendedDestination'ı
  // NJ_DEPO/CG_DEPO olsa da bakılmaz). Şimdilik yalnız US tab'ı; diğer tab'larda atlanır.
  // Idempotent: arrivedAt damgalı konteyner atlanır.
  let containerLinesAdded = 0;
  let containerUnitsAdded = 0;
  if (shipment.destinationTab === 'US') {
    const containers = await tx.shipmentContainer.findMany({
      where: { shipmentId, arrivedAt: null },
      include: { lines: true },
    });
    if (containers.length > 0) {
      const ffPoolId = await getPool('SHOWROOM');
      for (const container of containers) {
        for (const line of container.lines) {
          await tx.shelfStock.upsert({
            where: { shelfId_iwasku: { shelfId: ffPoolId, iwasku: line.iwasku } },
            create: { warehouseCode: 'SHOWROOM', shelfId: ffPoolId, iwasku: line.iwasku, quantity: line.quantity },
            update: { quantity: { increment: line.quantity } },
          });
          await tx.shelfMovement.create({
            data: {
              warehouseCode: 'SHOWROOM',
              type: 'INBOUND_FROM_SHIPMENT',
              toShelfId: ffPoolId,
              iwasku: line.iwasku,
              quantity: line.quantity,
              refType: 'SHIPMENT',
              refId: shipmentId,
              userId,
              notes: `Sevkiyat ${shipment.name} varışı — Fairfield toplu gönderim ${container.code} (${line.quantity} adet)`,
            },
          });
          containerLinesAdded++;
          containerUnitsAdded += line.quantity;
        }
        await tx.shipmentContainer.update({ where: { id: container.id }, data: { arrivedAt: new Date() } });
      }
      if (containerUnitsAdded > 0) {
        distribution['SHOWROOM'] = (distribution['SHOWROOM'] ?? 0) + containerUnitsAdded;
      }
    }
  }

  return { warehouseDistribution: distribution, boxesCreated, boxesSkipped, containerLinesAdded, containerUnitsAdded };
}
