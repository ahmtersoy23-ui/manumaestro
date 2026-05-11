import { describe, expect, it } from 'vitest';
import {
  PickSchema,
  AllocationSchema,
  ShipAllocateSchema,
  pickSum,
  validateAllocationsCoverage,
  type Allocation,
} from '@/lib/wms/shipAllocateSchemas';

describe('PickSchema', () => {
  it('STOCK kaynağı shelfStockId + shelfId ile geçerli', () => {
    const r = PickSchema.safeParse({
      source: 'STOCK',
      shelfId: 'shelf-1',
      shelfStockId: 'stock-1',
      qty: 5,
    });
    expect(r.success).toBe(true);
  });

  it('STOCK için shelfStockId eksikse reddeder', () => {
    const r = PickSchema.safeParse({
      source: 'STOCK',
      shelfId: 'shelf-1',
      qty: 5,
    });
    expect(r.success).toBe(false);
  });

  it('STOCK için shelfId eksikse reddeder', () => {
    const r = PickSchema.safeParse({
      source: 'STOCK',
      shelfStockId: 'stock-1',
      qty: 5,
    });
    expect(r.success).toBe(false);
  });

  it('BOX kaynağı shelfBoxId ile geçerli', () => {
    const r = PickSchema.safeParse({
      source: 'BOX',
      shelfBoxId: 'box-1',
      qty: 5,
    });
    expect(r.success).toBe(true);
  });

  it('BOX için shelfBoxId eksikse reddeder', () => {
    const r = PickSchema.safeParse({
      source: 'BOX',
      qty: 5,
    });
    expect(r.success).toBe(false);
  });

  it('qty 0 reddedilir', () => {
    expect(
      PickSchema.safeParse({ source: 'BOX', shelfBoxId: 'b1', qty: 0 }).success
    ).toBe(false);
  });

  it('qty negatif reddedilir', () => {
    expect(
      PickSchema.safeParse({ source: 'BOX', shelfBoxId: 'b1', qty: -3 }).success
    ).toBe(false);
  });

  it('qty 100000 üzeri reddedilir (DoS koruması)', () => {
    expect(
      PickSchema.safeParse({ source: 'BOX', shelfBoxId: 'b1', qty: 100001 }).success
    ).toBe(false);
  });

  it('qty ondalıklı reddedilir (int only)', () => {
    expect(
      PickSchema.safeParse({ source: 'BOX', shelfBoxId: 'b1', qty: 1.5 }).success
    ).toBe(false);
  });

  it('source enum dışı değer reddedilir', () => {
    expect(
      PickSchema.safeParse({ source: 'SHELF', shelfBoxId: 'b1', qty: 5 }).success
    ).toBe(false);
  });
});

describe('AllocationSchema', () => {
  it('Boş picks reddedilir', () => {
    const r = AllocationSchema.safeParse({ itemId: 'i1', picks: [] });
    expect(r.success).toBe(false);
  });

  it('20\'den fazla pick reddedilir', () => {
    const picks = Array.from({ length: 21 }, () => ({
      source: 'BOX' as const,
      shelfBoxId: 'b1',
      qty: 1,
    }));
    const r = AllocationSchema.safeParse({ itemId: 'i1', picks });
    expect(r.success).toBe(false);
  });

  it('Boş itemId reddedilir', () => {
    const r = AllocationSchema.safeParse({
      itemId: '',
      picks: [{ source: 'BOX', shelfBoxId: 'b1', qty: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it('Yalnızca boşluklardan oluşan itemId trim sonrası reddedilir', () => {
    const r = AllocationSchema.safeParse({
      itemId: '   ',
      picks: [{ source: 'BOX', shelfBoxId: 'b1', qty: 1 }],
    });
    expect(r.success).toBe(false);
  });
});

describe('ShipAllocateSchema', () => {
  it('Boş allocations reddedilir', () => {
    expect(ShipAllocateSchema.safeParse({ allocations: [] }).success).toBe(false);
  });

  it('50\'den fazla allocation reddedilir', () => {
    const allocations = Array.from({ length: 51 }, (_, i) => ({
      itemId: `i${i}`,
      picks: [{ source: 'BOX' as const, shelfBoxId: 'b1', qty: 1 }],
    }));
    expect(ShipAllocateSchema.safeParse({ allocations }).success).toBe(false);
  });

  it('Geçerli payload: tek allocation tek STOCK pick', () => {
    const r = ShipAllocateSchema.safeParse({
      allocations: [
        {
          itemId: 'i1',
          picks: [{ source: 'STOCK', shelfId: 's1', shelfStockId: 'ss1', qty: 10 }],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('Geçerli payload: split — bir item için STOCK + BOX karışık', () => {
    const r = ShipAllocateSchema.safeParse({
      allocations: [
        {
          itemId: 'i1',
          picks: [
            { source: 'STOCK', shelfId: 's1', shelfStockId: 'ss1', qty: 5 },
            { source: 'BOX', shelfBoxId: 'b1', qty: 3 },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe('pickSum', () => {
  it('toplam doğru hesaplar', () => {
    expect(
      pickSum([
        { source: 'STOCK', shelfId: 's', shelfStockId: 'ss', qty: 7 },
        { source: 'BOX', shelfBoxId: 'b', qty: 3 },
      ])
    ).toBe(10);
  });

  it('boş array 0 döner', () => {
    expect(pickSum([])).toBe(0);
  });
});

describe('validateAllocationsCoverage', () => {
  const mkItem = (id: string, iwasku: string, quantity: number) => ({ id, iwasku, quantity });
  const mkAlloc = (itemId: string, qty: number): Allocation => ({
    itemId,
    picks: [{ source: 'BOX', shelfBoxId: 'b1', qty }],
  });

  it('toplam eşitliği + tam kapsam → null (hata yok)', () => {
    const items = [mkItem('i1', 'SKU1', 10), mkItem('i2', 'SKU2', 5)];
    const allocations = [mkAlloc('i1', 10), mkAlloc('i2', 5)];
    expect(validateAllocationsCoverage(allocations, items)).toBeNull();
  });

  it('allocation toplamı item quantity\'den az → hata mesajı', () => {
    const items = [mkItem('i1', 'SKU1', 10)];
    const allocations = [mkAlloc('i1', 7)];
    const err = validateAllocationsCoverage(allocations, items);
    expect(err).not.toBeNull();
    expect(err).toContain('SKU1');
    expect(err).toContain('10');
    expect(err).toContain('7');
  });

  it('allocation toplamı item quantity\'den fazla → hata mesajı', () => {
    const items = [mkItem('i1', 'SKU1', 10)];
    const allocations: Allocation[] = [
      {
        itemId: 'i1',
        picks: [
          { source: 'BOX', shelfBoxId: 'b1', qty: 8 },
          { source: 'BOX', shelfBoxId: 'b2', qty: 5 },
        ],
      },
    ];
    const err = validateAllocationsCoverage(allocations, items);
    expect(err).toContain('SKU1');
    expect(err).toContain('13');
  });

  it('eksik sipariş kalemi için allocation yoksa hata', () => {
    const items = [mkItem('i1', 'SKU1', 10), mkItem('i2', 'SKU2', 5)];
    const allocations = [mkAlloc('i1', 10)];
    const err = validateAllocationsCoverage(allocations, items);
    expect(err).toContain('SKU2');
    expect(err).toContain('raf seçimi eksik');
  });

  it('bilinmeyen itemId hata verir', () => {
    const items = [mkItem('i1', 'SKU1', 10)];
    const allocations = [mkAlloc('iX', 10)];
    const err = validateAllocationsCoverage(allocations, items);
    expect(err).toContain('iX');
    expect(err).toContain('bulunamadı');
  });

  it('split allocation (multiple picks) toplamı doğru kontrol eder', () => {
    const items = [mkItem('i1', 'SKU1', 12)];
    const allocations: Allocation[] = [
      {
        itemId: 'i1',
        picks: [
          { source: 'BOX', shelfBoxId: 'b1', qty: 7 },
          { source: 'STOCK', shelfId: 's1', shelfStockId: 'ss1', qty: 5 },
        ],
      },
    ];
    expect(validateAllocationsCoverage(allocations, items)).toBeNull();
  });

  it('boş items + boş allocations → null (edge: hiçbir kalem yok)', () => {
    expect(validateAllocationsCoverage([], [])).toBeNull();
  });

  it('items var, allocations boş → ilk eksik kalemi raporlar', () => {
    const items = [mkItem('i1', 'SKU1', 1)];
    const err = validateAllocationsCoverage([], items);
    expect(err).toContain('SKU1');
  });
});
