/**
 * ATP (Available to Promise) Calculation Tests
 * Verifies stock calculation and seasonal reserve logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing the module under test
const mockWarehouseProductFindMany = vi.fn();
const mockStockReserveFindMany = vi.fn();
const mockShipmentItemGroupBy = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    warehouseProduct: {
      findMany: (...args: unknown[]) => mockWarehouseProductFindMany(...args),
    },
    stockReserve: {
      findMany: (...args: unknown[]) => mockStockReserveFindMany(...args),
    },
    shipmentItem: {
      groupBy: (...args: unknown[]) => mockShipmentItemGroupBy(...args),
    },
  },
}));

import { getATPBulk, getATP, getATPAll, getATPMap } from '@/lib/db/atp';

describe('ATP Calculations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no shipment reservations — testler ihtiyaca göre override eder
    mockShipmentItemGroupBy.mockResolvedValue([]);
  });

  describe('getATPBulk', () => {
    it('should return empty array when no products requested', async () => {
      const result = await getATPBulk([]);

      expect(result).toEqual([]);
      // Should not call DB at all
      expect(mockWarehouseProductFindMany).not.toHaveBeenCalled();
      expect(mockStockReserveFindMany).not.toHaveBeenCalled();
    });

    it('should return zeros when product not found in warehouse', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([]);
      mockStockReserveFindMany.mockResolvedValue([]);

      const result = await getATPBulk(['SKU-MISSING']);

      expect(result).toEqual([
        { iwasku: 'SKU-MISSING', mevcut: 0, reserved: 0, shipmentReserved: 0, atp: 0 },
      ]);
    });

    it('should calculate mevcut correctly with no reserves (atp = mevcut)', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([
        {
          iwasku: 'SKU-100',
          eskiStok: 50,
          ilaveStok: 10,
          cikis: 5,
          weeklyEntries: [
            { quantity: 20, type: 'PRODUCTION' },
            { quantity: 8, type: 'SHIPMENT' },
          ],
        },
      ]);

      mockStockReserveFindMany.mockResolvedValue([]);

      const result = await getATPBulk(['SKU-100']);

      // mevcut = eskiStok(50) + ilaveStok(10) + production(20) - cikis(5) - shipment(8) = 67
      expect(result).toEqual([
        { iwasku: 'SKU-100', mevcut: 67, reserved: 0, shipmentReserved: 0, atp: 67 },
      ]);
    });

    it('should subtract initialStock-based reserve from atp', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([
        {
          iwasku: 'SKU-200',
          eskiStok: 100,
          ilaveStok: 0,
          cikis: 0,
          weeklyEntries: [],
        },
      ]);

      // Reserve with initialStock=30, shipped=10 -> reserved = 20
      mockStockReserveFindMany.mockResolvedValue([
        { iwasku: 'SKU-200', initialStock: 30, producedQuantity: 0, shippedQuantity: 10 },
      ]);

      const result = await getATPBulk(['SKU-200']);

      // mevcut = 100, reserved = 30-10 = 20, atp = 100-20 = 80
      expect(result).toEqual([
        { iwasku: 'SKU-200', mevcut: 100, reserved: 20, shipmentReserved: 0, atp: 80 },
      ]);
    });

    it('should include producedQuantity in reserve calculation (snapshot ile aynı formül)', async () => {
      // Sezon rezervi formülü = initialStock + producedQuantity - shippedQuantity
      // (snapshot route'undaki hesapla aynı)
      mockWarehouseProductFindMany.mockResolvedValue([
        {
          iwasku: 'SKU-300',
          eskiStok: 100,
          ilaveStok: 0,
          cikis: 0,
          weeklyEntries: [],
        },
      ]);

      mockStockReserveFindMany.mockResolvedValue([
        { iwasku: 'SKU-300', initialStock: 40, producedQuantity: 20, shippedQuantity: 5 },
      ]);

      const result = await getATPBulk(['SKU-300']);

      // reserved = 40 + 20 - 5 = 55, atp = 100 - 55 = 45
      expect(result).toEqual([
        { iwasku: 'SKU-300', mevcut: 100, reserved: 55, shipmentReserved: 0, atp: 45 },
      ]);

      // producedQuantity select clause'da olmalı
      const selectArg = mockStockReserveFindMany.mock.calls[0][0].select;
      expect(selectArg).toHaveProperty('producedQuantity', true);
    });

    it('should sum multiple reserves for the same product', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([
        {
          iwasku: 'SKU-400',
          eskiStok: 200,
          ilaveStok: 0,
          cikis: 0,
          weeklyEntries: [],
        },
      ]);

      // Two separate reserves for the same SKU
      mockStockReserveFindMany.mockResolvedValue([
        { iwasku: 'SKU-400', initialStock: 50, producedQuantity: 0, shippedQuantity: 10 },  // 40
        { iwasku: 'SKU-400', initialStock: 30, producedQuantity: 0, shippedQuantity: 5 },   // 25
      ]);

      const result = await getATPBulk(['SKU-400']);

      // reserved = (50-10) + (30-5) = 40 + 25 = 65
      // atp = 200 - 65 = 135
      expect(result).toEqual([
        { iwasku: 'SKU-400', mevcut: 200, reserved: 65, shipmentReserved: 0, atp: 135 },
      ]);
    });

    it('should clamp reserved and atp to minimum 0', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([
        {
          iwasku: 'SKU-500',
          eskiStok: 10,
          ilaveStok: 0,
          cikis: 0,
          weeklyEntries: [],
        },
      ]);

      // Reserve is larger than mevcut
      mockStockReserveFindMany.mockResolvedValue([
        { iwasku: 'SKU-500', initialStock: 50, producedQuantity: 0, shippedQuantity: 0 },
      ]);

      const result = await getATPBulk(['SKU-500']);

      // mevcut = 10, reserved = 50, atp = max(0, 10-50) = 0
      expect(result).toEqual([
        { iwasku: 'SKU-500', mevcut: 10, reserved: 50, shipmentReserved: 0, atp: 0 },
      ]);
    });

    it('should handle multiple products in a single call', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([
        {
          iwasku: 'SKU-A',
          eskiStok: 100,
          ilaveStok: 20,
          cikis: 10,
          weeklyEntries: [{ quantity: 30, type: 'PRODUCTION' }],
        },
        {
          iwasku: 'SKU-B',
          eskiStok: 50,
          ilaveStok: 0,
          cikis: 0,
          weeklyEntries: [{ quantity: 15, type: 'SHIPMENT' }],
        },
      ]);

      mockStockReserveFindMany.mockResolvedValue([
        { iwasku: 'SKU-A', initialStock: 20, producedQuantity: 0, shippedQuantity: 5 },
      ]);

      const result = await getATPBulk(['SKU-A', 'SKU-B']);

      // SKU-A: mevcut = 100+20+30-10-0 = 140, reserved = 15, atp = 125
      expect(result[0]).toEqual({ iwasku: 'SKU-A', mevcut: 140, reserved: 15, shipmentReserved: 0, atp: 125 });
      // SKU-B: mevcut = 50+0+0-0-15 = 35, reserved = 0, atp = 35
      expect(result[1]).toEqual({ iwasku: 'SKU-B', mevcut: 35, reserved: 0, shipmentReserved: 0, atp: 35 });
    });

    it('should subtract shipment reserve (packed but not sent) from atp', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([
        {
          iwasku: 'SKU-SHIP',
          eskiStok: 100,
          ilaveStok: 0,
          cikis: 0,
          weeklyEntries: [],
        },
      ]);
      mockStockReserveFindMany.mockResolvedValue([
        { iwasku: 'SKU-SHIP', initialStock: 20, producedQuantity: 0, shippedQuantity: 5 },
      ]);
      // 3 koli toplamda 30 adet, henüz sevk edilmemiş
      mockShipmentItemGroupBy.mockResolvedValue([
        { iwasku: 'SKU-SHIP', _sum: { quantity: 30 } },
      ]);

      const result = await getATPBulk(['SKU-SHIP']);

      // mevcut=100, reserved=15, shipmentReserved=30, atp=max(0, 100-15-30)=55
      expect(result).toEqual([
        { iwasku: 'SKU-SHIP', mevcut: 100, reserved: 15, shipmentReserved: 30, atp: 55 },
      ]);
    });

    it('should handle weeklyEntries with mixed PRODUCTION and SHIPMENT', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([
        {
          iwasku: 'SKU-MIX',
          eskiStok: 80,
          ilaveStok: 5,
          cikis: 3,
          weeklyEntries: [
            { quantity: 10, type: 'PRODUCTION' },
            { quantity: 25, type: 'PRODUCTION' },
            { quantity: 12, type: 'SHIPMENT' },
            { quantity: 8, type: 'SHIPMENT' },
          ],
        },
      ]);

      mockStockReserveFindMany.mockResolvedValue([]);

      const result = await getATPBulk(['SKU-MIX']);

      // mevcut = 80 + 5 + (10+25) - 3 - (12+8) = 80 + 5 + 35 - 3 - 20 = 97
      expect(result).toEqual([
        { iwasku: 'SKU-MIX', mevcut: 97, reserved: 0, shipmentReserved: 0, atp: 97 },
      ]);
    });
  });

  describe('getATP', () => {
    it('should return result for a single product', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([
        {
          iwasku: 'SKU-SINGLE',
          eskiStok: 50,
          ilaveStok: 0,
          cikis: 0,
          weeklyEntries: [],
        },
      ]);
      mockStockReserveFindMany.mockResolvedValue([]);

      const result = await getATP('SKU-SINGLE');

      expect(result).toEqual({ iwasku: 'SKU-SINGLE', mevcut: 50, reserved: 0, shipmentReserved: 0, atp: 50 });
    });

    it('should return zeros when product not found', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([]);
      mockStockReserveFindMany.mockResolvedValue([]);

      const result = await getATP('SKU-NOPE');

      expect(result).toEqual({ iwasku: 'SKU-NOPE', mevcut: 0, reserved: 0, shipmentReserved: 0, atp: 0 });
    });
  });

  describe('getATPAll', () => {
    it('should fetch all warehouse products and calculate ATP', async () => {
      // First call: getATPAll fetches all iwaskus
      mockWarehouseProductFindMany
        .mockResolvedValueOnce([{ iwasku: 'SKU-X' }, { iwasku: 'SKU-Y' }])
        // Second call: getATPBulk fetches full product data
        .mockResolvedValueOnce([
          { iwasku: 'SKU-X', eskiStok: 30, ilaveStok: 0, cikis: 0, weeklyEntries: [] },
          { iwasku: 'SKU-Y', eskiStok: 60, ilaveStok: 0, cikis: 0, weeklyEntries: [] },
        ]);

      mockStockReserveFindMany.mockResolvedValue([]);

      const result = await getATPAll();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ iwasku: 'SKU-X', mevcut: 30, reserved: 0, shipmentReserved: 0, atp: 30 });
      expect(result[1]).toEqual({ iwasku: 'SKU-Y', mevcut: 60, reserved: 0, shipmentReserved: 0, atp: 60 });
    });
  });

  describe('getATPMap', () => {
    it('should return a Map keyed by iwasku', async () => {
      mockWarehouseProductFindMany.mockResolvedValue([
        { iwasku: 'SKU-M1', eskiStok: 40, ilaveStok: 0, cikis: 0, weeklyEntries: [] },
      ]);
      mockStockReserveFindMany.mockResolvedValue([]);

      const map = await getATPMap(['SKU-M1']);

      expect(map).toBeInstanceOf(Map);
      expect(map.get('SKU-M1')).toEqual({ iwasku: 'SKU-M1', mevcut: 40, reserved: 0, shipmentReserved: 0, atp: 40 });
    });
  });
});
