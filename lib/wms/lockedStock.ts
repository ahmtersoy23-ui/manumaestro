/**
 * Row-level locking helper for WMS stock mutations.
 *
 * Postgres `SELECT ... FOR UPDATE` ile satır kilitleyerek concurrent
 * rezerve / outbound çakışmalarını önler. Kilit transaction sonunda
 * otomatik bırakılır — sadece `prisma.$transaction()` içinde anlamlı.
 *
 * Kullanım:
 *   await prisma.$transaction(async (tx) => {
 *     const stock = await lockShelfStockByPair(tx, shelfId, iwasku);
 *     if (!stock) throw new Error('Raf stoğu yok');
 *     // ... safely mutate
 *   });
 */

import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface LockedShelfStock {
  id: string;
  shelfId: string;
  iwasku: string;
  quantity: number;
  reservedQty: number;
  warehouseCode: string;
}

export interface LockedShelfBox {
  id: string;
  shelfId: string;
  iwasku: string;
  quantity: number;
  reservedQty: number;
  warehouseCode: string;
  status: string;
  boxNumber: string;
}

export async function lockShelfStockById(tx: Tx, id: string): Promise<LockedShelfStock | null> {
  const rows = await tx.$queryRaw<LockedShelfStock[]>`
    SELECT id, "shelfId", iwasku, quantity, "reservedQty", "warehouseCode"
    FROM shelf_stock
    WHERE id = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function lockShelfStockByPair(
  tx: Tx,
  shelfId: string,
  iwasku: string
): Promise<LockedShelfStock | null> {
  const rows = await tx.$queryRaw<LockedShelfStock[]>`
    SELECT id, "shelfId", iwasku, quantity, "reservedQty", "warehouseCode"
    FROM shelf_stock
    WHERE "shelfId" = ${shelfId} AND iwasku = ${iwasku}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function lockShelfBoxById(tx: Tx, id: string): Promise<LockedShelfBox | null> {
  const rows = await tx.$queryRaw<LockedShelfBox[]>`
    SELECT id, "shelfId", iwasku, quantity, "reservedQty", "warehouseCode",
           status::text AS status, "boxNumber"
    FROM shelf_boxes
    WHERE id = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export class NegativeInventoryError extends Error {
  constructor(public detail: string) {
    super(`NEGATIVE_INVENTORY: ${detail}`);
    this.name = 'NegativeInventoryError';
  }
}

export function assertNonNegative(label: string, value: number): void {
  if (value < 0) throw new NegativeInventoryError(`${label} negatif olamaz (${value})`);
}
