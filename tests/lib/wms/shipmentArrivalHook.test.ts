import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { processShipmentArrival, resolveTargetWarehouse } from '@/lib/wms/shipmentArrivalHook';

// ── resolveTargetWarehouse (saf routing tablosu) ──
describe('resolveTargetWarehouse', () => {
  it('US + SHOWROOM → SHOWROOM', () => {
    expect(resolveTargetWarehouse('US', 'SHOWROOM')).toBe('SHOWROOM');
  });
  it('US + DEPO → NJ', () => {
    expect(resolveTargetWarehouse('US', 'DEPO')).toBe('NJ');
  });
  it('US + FBA → null (depoya girmez)', () => {
    expect(resolveTargetWarehouse('US', 'FBA')).toBeNull();
  });
  it('EU + DEPO → NL, EU + NL → NL', () => {
    expect(resolveTargetWarehouse('EU', 'DEPO')).toBe('NL');
    expect(resolveTargetWarehouse('EU', 'NL')).toBe('NL');
  });
  it('EU + FBA → null', () => {
    expect(resolveTargetWarehouse('EU', 'FBA')).toBeNull();
  });
  it('UK/CA/AU/ZA → null (raf takibinde değil)', () => {
    for (const tab of ['UK', 'CA', 'AU', 'ZA']) {
      expect(resolveTargetWarehouse(tab, 'DEPO')).toBeNull();
    }
  });
});

// ── processShipmentArrival (mock tx ile orkestrasyon) ──
type Box = {
  id: string;
  destination: string;
  iwasku: string | null;
  boxNumber: string;
  quantity: number;
  fnsku?: string | null;
  marketplaceCode?: string | null;
};

type Container = { id: string; code: string; lines: { iwasku: string; quantity: number }[] };

function makeTx(opts: {
  shipment: { id: string; name: string; destinationTab: string; boxes: Box[]; shippingMethod?: string } | null;
  containers?: Container[]; // konsolidasyon paletleri (arrivedAt=null kabul edilir)
  activeWarehouses?: string[]; // code listesi (isActive=true)
  poolsFor?: string[]; // POOL rafı olan depo kodları
  existingShelfBoxIds?: string[]; // idempotency: zaten yansımış box id'leri
}) {
  const active = new Set(opts.activeWarehouses ?? ['NJ', 'SHOWROOM', 'NL']);
  const pools = new Set(opts.poolsFor ?? ['NJ', 'SHOWROOM', 'NL']);
  const existing = new Set(opts.existingShelfBoxIds ?? []);

  const shelfBoxCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `sb-${data.shipmentBoxId}`,
    ...data,
  }));
  const shelfMovementCreate = vi.fn(async () => ({ id: 'mv' }));
  const shelfStockUpsert = vi.fn(async (_args: { create: Record<string, unknown>; update: unknown; where: unknown }) => ({ id: 'ss' }));
  const containerUpdate = vi.fn(async () => ({ id: 'c' }));

  const tx = {
    shipment: { findUnique: vi.fn(async () => opts.shipment) },
    warehouse: {
      findUnique: vi.fn(async ({ where }: { where: { code: string } }) =>
        active.has(where.code) ? { code: where.code, isActive: true } : null,
      ),
    },
    shelf: {
      findFirst: vi.fn(async ({ where }: { where: { warehouseCode: string } }) =>
        pools.has(where.warehouseCode) ? { id: `pool-${where.warehouseCode}` } : null,
      ),
    },
    shelfBox: {
      findUnique: vi.fn(async ({ where }: { where: { shipmentBoxId: string } }) =>
        existing.has(where.shipmentBoxId) ? { id: `existing-${where.shipmentBoxId}` } : null,
      ),
      create: shelfBoxCreate,
    },
    shelfMovement: { create: shelfMovementCreate },
    shipmentContainer: {
      findMany: vi.fn(async () => opts.containers ?? []),
      update: containerUpdate,
    },
    shelfStock: { upsert: shelfStockUpsert },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, shelfBoxCreate, shelfMovementCreate, shelfStockUpsert, containerUpdate };
}

const box = (id: string, destination: string, extra: Partial<Box> = {}): Box => ({
  id,
  destination,
  iwasku: `IW-${id}`,
  boxNumber: id,
  quantity: 10,
  ...extra,
});

describe('processShipmentArrival', () => {
  it('sevkiyat yoksa hata fırlatır', async () => {
    const { tx } = makeTx({ shipment: null });
    await expect(processShipmentArrival(tx, 's1', 'u1')).rejects.toThrow('Sevkiyat bulunamadı');
  });

  it('US karma: SHOWROOM→SHOWROOM, DEPO→NJ, FBA atlanır, iwasku yok atlanır', async () => {
    const { tx, shelfBoxCreate, shelfMovementCreate } = makeTx({
      shipment: {
        id: 's1',
        name: 'Gemi 99',
        destinationTab: 'US',
        boxes: [
          box('b1', 'SHOWROOM'),
          box('b2', 'DEPO'),
          box('b3', 'FBA'), // atla
          box('b4', 'DEPO', { iwasku: null }), // iwasku yok → atla
        ],
      },
    });

    const res = await processShipmentArrival(tx, 's1', 'u1');

    expect(res.boxesCreated).toBe(2);
    expect(res.boxesSkipped).toBe(2);
    expect(res.warehouseDistribution).toEqual({ SHOWROOM: 1, NJ: 1 });
    expect(shelfBoxCreate).toHaveBeenCalledTimes(2);
    expect(shelfMovementCreate).toHaveBeenCalledTimes(2);
    // Doğru depo+pool eşleşmesi
    const created = shelfBoxCreate.mock.calls.map((c) => c[0].data);
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warehouseCode: 'SHOWROOM', shelfId: 'pool-SHOWROOM', status: 'SEALED' }),
        expect.objectContaining({ warehouseCode: 'NJ', shelfId: 'pool-NJ', status: 'SEALED' }),
      ]),
    );
  });

  it('idempotent: zaten yansımış box tekrar yaratılmaz', async () => {
    const { tx, shelfBoxCreate } = makeTx({
      shipment: {
        id: 's1',
        name: 'Gemi 99',
        destinationTab: 'US',
        boxes: [box('b1', 'DEPO'), box('b2', 'DEPO')],
      },
      existingShelfBoxIds: ['b1'], // b1 zaten var
    });

    const res = await processShipmentArrival(tx, 's1', 'u1');

    expect(res.boxesCreated).toBe(1);
    expect(res.boxesSkipped).toBe(1);
    expect(shelfBoxCreate).toHaveBeenCalledTimes(1);
    expect(shelfBoxCreate.mock.calls[0][0].data).toMatchObject({ shipmentBoxId: 'b2' });
  });

  it('EU DEPO → NL', async () => {
    const { tx, shelfBoxCreate } = makeTx({
      shipment: { id: 's2', name: 'TIR 5', destinationTab: 'EU', boxes: [box('b1', 'DEPO')] },
    });
    const res = await processShipmentArrival(tx, 's2', 'u1');
    expect(res.warehouseDistribution).toEqual({ NL: 1 });
    expect(shelfBoxCreate.mock.calls[0][0].data).toMatchObject({ warehouseCode: 'NL' });
  });

  it('hedef depo pasif/yoksa hata fırlatır (DELIVERED bloklanır)', async () => {
    const { tx } = makeTx({
      shipment: { id: 's1', name: 'Gemi 99', destinationTab: 'US', boxes: [box('b1', 'DEPO')] },
      activeWarehouses: [], // NJ aktif değil
    });
    await expect(processShipmentArrival(tx, 's1', 'u1')).rejects.toThrow(/NJ.*yok veya pasif/);
  });

  it('POOL raf yoksa hata fırlatır', async () => {
    const { tx } = makeTx({
      shipment: { id: 's1', name: 'Gemi 99', destinationTab: 'US', boxes: [box('b1', 'DEPO')] },
      poolsFor: [], // POOL raf yok
    });
    await expect(processShipmentArrival(tx, 's1', 'u1')).rejects.toThrow(/POOL raf yok/);
  });

  it('US konsolidasyon paleti → Fairfield (SHOWROOM) POOL ShelfStock olarak patlar', async () => {
    const { tx, shelfStockUpsert, containerUpdate, shelfMovementCreate } = makeTx({
      shipment: { id: 's1', name: 'Gemi 72', destinationTab: 'US', boxes: [] },
      containers: [
        { id: 'c1', code: '72-K01', lines: [
          { iwasku: 'IW-A', quantity: 5 },
          { iwasku: 'IW-B', quantity: 3 },
        ] },
      ],
    });

    const res = await processShipmentArrival(tx, 's1', 'u1');

    expect(res.containerLinesAdded).toBe(2);
    expect(res.containerUnitsAdded).toBe(8);
    expect(res.warehouseDistribution).toEqual({ SHOWROOM: 8 });
    expect(shelfStockUpsert).toHaveBeenCalledTimes(2);
    expect(shelfMovementCreate).toHaveBeenCalledTimes(2);
    expect(containerUpdate).toHaveBeenCalledTimes(1); // arrivedAt damgası
    // Tüm satırlar Fairfield (SHOWROOM) POOL'una — recommendedDestination'a bakılmaz
    const upserts = shelfStockUpsert.mock.calls.map((c) => c[0].create);
    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warehouseCode: 'SHOWROOM', shelfId: 'pool-SHOWROOM', iwasku: 'IW-A', quantity: 5 }),
        expect.objectContaining({ warehouseCode: 'SHOWROOM', shelfId: 'pool-SHOWROOM', iwasku: 'IW-B', quantity: 3 }),
      ]),
    );
  });

  it('US olmayan tab: konteynerler patlamaz', async () => {
    const { tx, shelfStockUpsert, containerUpdate } = makeTx({
      shipment: { id: 's2', name: 'TIR 5', destinationTab: 'EU', boxes: [] },
      containers: [{ id: 'c1', code: '5-K01', lines: [{ iwasku: 'IW-A', quantity: 5 }] }],
    });
    const res = await processShipmentArrival(tx, 's2', 'u1');
    expect(res.containerLinesAdded).toBe(0);
    expect(res.containerUnitsAdded).toBe(0);
    expect(shelfStockUpsert).not.toHaveBeenCalled();
    expect(containerUpdate).not.toHaveBeenCalled();
  });

  it('Konteyner yöntemi: WMS raf yansıması YOK (CastleGate malı yerel depoya girmez)', async () => {
    const { tx, shelfBoxCreate, shelfStockUpsert, containerUpdate } = makeTx({
      shipment: {
        id: 'sc', name: 'CG Shukran 8 Los Angeles', destinationTab: 'US', shippingMethod: 'container',
        boxes: [box('b1', 'DEPO')], // olsa bile yansımaz
      },
      containers: [{ id: 'c1', code: '8-C01', lines: [{ iwasku: 'IW-A', quantity: 5 }] }],
    });
    const res = await processShipmentArrival(tx, 'sc', 'u1');
    expect(res).toEqual({ warehouseDistribution: {}, boxesCreated: 0, boxesSkipped: 0, containerLinesAdded: 0, containerUnitsAdded: 0 });
    expect(shelfBoxCreate).not.toHaveBeenCalled();
    expect(shelfStockUpsert).not.toHaveBeenCalled();
    expect(containerUpdate).not.toHaveBeenCalled();
  });

  it('UK sevkiyatı: hiçbir koli rafa yansımaz (hepsi atlanır)', async () => {
    const { tx, shelfBoxCreate } = makeTx({
      shipment: {
        id: 's3',
        name: 'Gemi UK',
        destinationTab: 'UK',
        boxes: [box('b1', 'DEPO'), box('b2', 'FBA')],
      },
    });
    const res = await processShipmentArrival(tx, 's3', 'u1');
    expect(res.boxesCreated).toBe(0);
    expect(res.boxesSkipped).toBe(2);
    expect(shelfBoxCreate).not.toHaveBeenCalled();
  });
});
