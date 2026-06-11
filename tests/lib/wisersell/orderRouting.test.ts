import { describe, it, expect } from 'vitest';
import { resolveOrderWarehouse, resolveOrderWarehouseOptions, isFurnitureOrder, needsManualSource, isEtsyChannel } from '@/lib/wisersell/orderRouting';
import { isHeavyItem } from '@/lib/products/lookup';

const us = (m: Record<string, { NJ: number; SHOWROOM: number }>) => new Map(Object.entries(m));
const cg = (m: Record<string, { CG_SHUKRAN: number; CG_MDN: number }>) => new Map(Object.entries(m));

describe('isHeavyItem', () => {
  it('Mobilya/Alsat eşik 4', () => {
    expect(isHeavyItem('Mobilya', 4)).toBe(true);
    expect(isHeavyItem('mobilya', 3)).toBe(false);
    expect(isHeavyItem('Alsat', 5)).toBe(true);
  });
  it('diğer kategoriler eşik 7', () => {
    expect(isHeavyItem('Kanvas', 7)).toBe(true);
    expect(isHeavyItem('Kanvas', 6)).toBe(false);
    expect(isHeavyItem(null, 8)).toBe(true);
  });
  it('desi yoksa heavy değil', () => {
    expect(isHeavyItem('Mobilya', null)).toBe(false);
    expect(isHeavyItem('Kanvas', undefined)).toBe(false);
  });
});

describe('resolveOrderWarehouse — CG routing', () => {
  it('heavy + Shukran karşılıyor → CG_SHUKRAN', () => {
    const items = [{ iwasku: 'A', qty: 1, desi: 9, category: 'Kanvas' }];
    expect(resolveOrderWarehouse(items, us({ A: { NJ: 5, SHOWROOM: 5 } }), cg({ A: { CG_SHUKRAN: 3, CG_MDN: 0 } }))).toBe('CG_SHUKRAN');
  });

  it('heavy + Shukran yetersiz, MDN karşılıyor → CG_MDN', () => {
    const items = [{ iwasku: 'A', qty: 2, desi: 9, category: 'Kanvas' }];
    expect(resolveOrderWarehouse(items, us({}), cg({ A: { CG_SHUKRAN: 1, CG_MDN: 5 } }))).toBe('CG_MDN');
  });

  it('heavy + CG boş → Fairfield fallback', () => {
    const items = [{ iwasku: 'A', qty: 1, desi: 9, category: 'Kanvas' }];
    expect(resolveOrderWarehouse(items, us({ A: { NJ: 0, SHOWROOM: 2 } }), cg({ A: { CG_SHUKRAN: 0, CG_MDN: 0 } }))).toBe('SHOWROOM');
  });

  it('mobilya ≥4 desi → CG (düşük eşik)', () => {
    const items = [{ iwasku: 'A', qty: 1, desi: 4, category: 'Mobilya' }];
    expect(resolveOrderWarehouse(items, us({}), cg({ A: { CG_SHUKRAN: 1, CG_MDN: 0 } }))).toBe('CG_SHUKRAN');
  });

  it('hafif ürün → CG yok sayılır, US routing', () => {
    const items = [{ iwasku: 'A', qty: 1, desi: 3, category: 'Kanvas' }];
    // CG'de stok olsa bile heavy değil → Fairfield yoksa Somerset
    expect(resolveOrderWarehouse(items, us({ A: { NJ: 5, SHOWROOM: 0 } }), cg({ A: { CG_SHUKRAN: 9, CG_MDN: 9 } }))).toBe('NJ');
  });

  it('karışık (heavy + hafif) → tümü heavy değil → CG yok sayılır', () => {
    const items = [
      { iwasku: 'A', qty: 1, desi: 9, category: 'Kanvas' },
      { iwasku: 'B', qty: 1, desi: 2, category: 'Kanvas' },
    ];
    expect(resolveOrderWarehouse(items, us({ A: { NJ: 0, SHOWROOM: 3 }, B: { NJ: 0, SHOWROOM: 3 } }), cg({ A: { CG_SHUKRAN: 9, CG_MDN: 0 }, B: { CG_SHUKRAN: 9, CG_MDN: 0 } }))).toBe('SHOWROOM');
  });

  it('iwasku eksik → null', () => {
    const items = [{ iwasku: null, qty: 1, desi: 9, category: 'Kanvas' }];
    expect(resolveOrderWarehouse(items, us({}), cg({}))).toBeNull();
  });

  it('hiçbiri karşılamıyor → null', () => {
    const items = [{ iwasku: 'A', qty: 5, desi: 9, category: 'Kanvas' }];
    expect(resolveOrderWarehouse(items, us({ A: { NJ: 1, SHOWROOM: 1 } }), cg({ A: { CG_SHUKRAN: 1, CG_MDN: 1 } }))).toBeNull();
  });

  it('cgAvail verilmezse (geriye dönük) sadece US routing', () => {
    const items = [{ iwasku: 'A', qty: 1, desi: 9, category: 'Kanvas' }];
    expect(resolveOrderWarehouse(items, us({ A: { NJ: 0, SHOWROOM: 2 } }))).toBe('SHOWROOM');
  });
});

describe('isFurnitureOrder', () => {
  it('içinde Mobilya kalemi varsa true (karma dahil)', () => {
    expect(isFurnitureOrder([{ iwasku: 'A', qty: 1, category: 'Mobilya' }])).toBe(true);
    expect(isFurnitureOrder([{ iwasku: 'A', qty: 1, category: 'Kanvas' }, { iwasku: 'B', qty: 1, category: 'mobilya' }])).toBe(true);
  });
  it('hiç Mobilya yoksa false', () => {
    expect(isFurnitureOrder([{ iwasku: 'A', qty: 1, category: 'Kanvas' }])).toBe(false);
    expect(isFurnitureOrder([{ iwasku: 'A', qty: 1, category: null }])).toBe(false);
  });
});

describe('needsManualSource', () => {
  const kanvas = [{ iwasku: 'A', qty: 1, category: 'Kanvas' }];
  const mobilya = [{ iwasku: 'A', qty: 1, category: 'Mobilya' }];
  it('mobilya → true (pazar yeri fark etmez)', () => {
    expect(needsManualSource(mobilya, 'AMZN_US')).toBe(true);
  });
  it('Amazon Citi (store_map kodu Ama_CITI) → true (kategori fark etmez)', () => {
    expect(needsManualSource(kanvas, 'Ama_CITI')).toBe(true);
    expect(needsManualSource(kanvas, 'CUSTOM_01')).toBe(true); // iç registry karşılığı
  });
  it('ne mobilya ne Citi → false (otomatik routing)', () => {
    expect(needsManualSource(kanvas, 'Ama_US')).toBe(false);
    expect(needsManualSource(kanvas, null)).toBe(false);
  });
});

describe('isEtsyChannel (tüm Etsy mağazaları)', () => {
  it('Etsy varyantlarını yakalar', () => {
    for (const code of ['Etsy_BMU', 'EtsyDHA', 'Etsy IWA', 'Etsy_SG', 'EtsyIHS', 'etsy_test']) {
      expect(isEtsyChannel(code)).toBe(true);
    }
  });
  it('Etsy olmayanlar → false', () => {
    expect(isEtsyChannel('Ama_US')).toBe(false);
    expect(isEtsyChannel('Wayfair Shukran')).toBe(false);
    expect(isEtsyChannel(null)).toBe(false);
    expect(isEtsyChannel(undefined)).toBe(false);
  });
});

describe('resolveOrderWarehouseOptions — mobilya manuel seçim', () => {
  it('karşılayan TÜM depoları döndürür (sıra: Fairfield, Somerset, Shukran, MDN)', () => {
    const items = [{ iwasku: 'A', qty: 1, desi: 9, category: 'Mobilya' }];
    const opts = resolveOrderWarehouseOptions(items, us({ A: { NJ: 5, SHOWROOM: 5 } }), cg({ A: { CG_SHUKRAN: 5, CG_MDN: 5 } }));
    expect(opts).toEqual(['SHOWROOM', 'NJ', 'CG_SHUKRAN', 'CG_MDN']);
  });

  it('sadece stoğu yetenler görünür (≥ adet)', () => {
    const items = [{ iwasku: 'A', qty: 3, desi: 9, category: 'Mobilya' }];
    const opts = resolveOrderWarehouseOptions(items, us({ A: { NJ: 2, SHOWROOM: 3 } }), cg({ A: { CG_SHUKRAN: 1, CG_MDN: 4 } }));
    expect(opts).toEqual(['SHOWROOM', 'CG_MDN']); // NJ(2)<3 ve Shukran(1)<3 elenir
  });

  it('çok kalem: tek depo TÜM kalemleri karşılamalı', () => {
    const items = [
      { iwasku: 'A', qty: 1, desi: 9, category: 'Mobilya' },
      { iwasku: 'B', qty: 2, desi: 9, category: 'Kanvas' },
    ];
    // SHOWROOM her ikisini karşılar; NJ B'de yetersiz → sadece SHOWROOM
    const opts = resolveOrderWarehouseOptions(items, us({ A: { NJ: 5, SHOWROOM: 5 }, B: { NJ: 1, SHOWROOM: 5 } }), cg({ A: { CG_SHUKRAN: 0, CG_MDN: 0 }, B: { CG_SHUKRAN: 0, CG_MDN: 0 } }));
    expect(opts).toEqual(['SHOWROOM']);
  });

  it('hiçbir depo karşılamıyor → [] (board gizler → otomatik TR)', () => {
    const items = [{ iwasku: 'A', qty: 5, desi: 9, category: 'Mobilya' }];
    expect(resolveOrderWarehouseOptions(items, us({ A: { NJ: 1, SHOWROOM: 1 } }), cg({ A: { CG_SHUKRAN: 1, CG_MDN: 1 } }))).toEqual([]);
  });

  it('iwasku eksik → []', () => {
    expect(resolveOrderWarehouseOptions([{ iwasku: null, qty: 1, category: 'Mobilya' }], us({}), cg({}))).toEqual([]);
  });
});
