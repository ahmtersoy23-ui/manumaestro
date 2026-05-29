/**
 * Toplu warehouseProduct upsert.
 *
 * Bir SKU için PR oluşturulduğunda (StockPulse sync, manuel "Yeni Talep",
 * Excel import veya suggestion accept), Ankara depo SKU listesinde
 * (warehouse_products tablosu) kayıt yoksa otomatik oluştur. Default değerler
 * (eskiStok/ilaveStok/cikis = 0) yeterli — depo operatörü daha sonra
 * gerekirse manuel güncelleyebilir.
 *
 * Bu sayede:
 *   - Snapshot generation (month-snapshot route) bu SKU'ları görür,
 *     warehouseStock=0 olarak yansır (UI'da "-" yerine "0").
 *   - Ankara depo operatörü yeni SKU sevkiyat geldiğinde önceden ellemek zorunda kalmaz.
 *
 * createMany + skipDuplicates: iwasku unique constraint var, ekleme idempotent.
 */

import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('EnsureWarehouseProducts');

export async function ensureWarehouseProducts(iwaskus: string[]): Promise<number> {
  const unique = [...new Set(iwaskus.filter(Boolean))];
  if (unique.length === 0) return 0;

  const result = await prisma.warehouseProduct.createMany({
    data: unique.map(iwasku => ({ iwasku })),
    skipDuplicates: true,
  });

  if (result.count > 0) {
    logger.info(`Eklendi ${result.count} yeni SKU warehouse_products'a`);
  }
  return result.count;
}
