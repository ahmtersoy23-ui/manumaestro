import { describe, it, expect } from 'vitest';
import { resolveOrderWarehouse, resolveOrderWarehouseOptions, resolveOrderSplit, isFurnitureOrder, needsManualSource, isEtsyChannel, isWayfairChannel } from '@/lib/wisersell/orderRouting';
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

describe('resolveOrderSplit — yalnız tam-ABD split', () => {
  it('tek depo hepsini karşılıyor → single (split gereksiz)', () => {
    const items = [{ iwasku: 'A', qty: 2, desi: 2, category: 'Kanvas' }];
    expect(resolveOrderSplit(items, us({ A: { NJ: 5, SHOWROOM: 0 } }), cg({}))).toEqual({ feasible: true, single: 'NJ', assignments: [] });
  });

  it('302005 senaryosu: 2li yalnız NJ, 9lu yalnız CG_SHUKRAN → split assignments', () => {
    const items = [
      { iwasku: 'DS00200WR0J9', qty: 2, desi: 3, category: 'Alsat' },   // yalnız NJ
      { iwasku: 'DS00200XD8T2', qty: 1, desi: 9, category: 'Alsat' },   // heavy → yalnız CG_SHUKRAN
    ];
    const usAvail = us({ 'DS00200WR0J9': { NJ: 5, SHOWROOM: 0 }, 'DS00200XD8T2': { NJ: 0, SHOWROOM: 0 } });
    const cgAvail = cg({ 'DS00200WR0J9': { CG_SHUKRAN: 0, CG_MDN: 0 }, 'DS00200XD8T2': { CG_SHUKRAN: 104, CG_MDN: 0 } });
    const plan = resolveOrderSplit(items, usAvail, cgAvail);
    expect(plan.feasible).toBe(true);
    expect(plan.single).toBeNull();
    expect(plan.assignments).toEqual([
      { iwasku: 'DS00200WR0J9', qty: 2, warehouse: 'NJ' },
      { iwasku: 'DS00200XD8T2', qty: 1, warehouse: 'CG_SHUKRAN' },
    ]);
  });

  it('bir kalem hiçbir ABD deposunda yok (TR gerekir) → feasible:false (gizle)', () => {
    const items = [
      { iwasku: 'A', qty: 2, desi: 3, category: 'Alsat' },   // NJ var
      { iwasku: 'B', qty: 1, desi: 3, category: 'Alsat' },   // hiçbir yerde yok
    ];
    const plan = resolveOrderSplit(items, us({ A: { NJ: 5, SHOWROOM: 0 }, B: { NJ: 0, SHOWROOM: 0 } }), cg({ A: { CG_SHUKRAN: 0, CG_MDN: 0 }, B: { CG_SHUKRAN: 0, CG_MDN: 0 } }));
    expect(plan.feasible).toBe(false);
  });

  it('iwasku eksik → feasible:false', () => {
    expect(resolveOrderSplit([{ iwasku: null, qty: 1, desi: 1, category: 'Kanvas' }], us({}), cg({})).feasible).toBe(false);
  });

  it('aynı iwasku iki satırda → adet toplanıp tek depodan karşılanır', () => {
    const items = [
      { iwasku: 'A', qty: 2, desi: 3, category: 'Kanvas' },
      { iwasku: 'A', qty: 2, desi: 3, category: 'Kanvas' },   // toplam 4
      { iwasku: 'B', qty: 1, desi: 9, category: 'Kanvas' },   // heavy → CG
    ];
    const usAvail = us({ A: { NJ: 3, SHOWROOM: 0 }, B: { NJ: 0, SHOWROOM: 0 } }); // A toplam 4 > NJ 3 → karşılanmaz
    const cgAvail = cg({ A: { CG_SHUKRAN: 0, CG_MDN: 0 }, B: { CG_SHUKRAN: 5, CG_MDN: 0 } });
    expect(resolveOrderSplit(items, usAvail, cgAvail).feasible).toBe(false); // A 4 adet hiçbir tek depoda yok

    const usAvail2 = us({ A: { NJ: 4, SHOWROOM: 0 }, B: { NJ: 0, SHOWROOM: 0 } }); // NJ 4 = 4 ✓
    const plan = resolveOrderSplit(items, usAvail2, cgAvail);
    expect(plan.feasible).toBe(true);
    expect(plan.single).toBeNull();
    expect(plan.assignments).toEqual([
      { iwasku: 'A', qty: 4, warehouse: 'NJ' },
      { iwasku: 'B', qty: 1, warehouse: 'CG_SHUKRAN' },
    ]);
  });

  it('Wayfair (cgAvail=undefined) → CG denenmez; US yetmezse feasible:false', () => {
    const items = [
      { iwasku: 'A', qty: 1, desi: 3, category: 'Kanvas' },   // NJ var
      { iwasku: 'B', qty: 1, desi: 9, category: 'Kanvas' },   // heavy ama CG yok sayılır, US'te yok
    ];
    const usAvail = us({ A: { NJ: 5, SHOWROOM: 0 }, B: { NJ: 0, SHOWROOM: 0 } });
    expect(resolveOrderSplit(items, usAvail, undefined).feasible).toBe(false);
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

describe('isWayfairChannel (dropship kanalı)', () => {
  it('Wayfair mağazalarını yakalar', () => {
    expect(isWayfairChannel('Wayfair Shukran')).toBe(true);
    expect(isWayfairChannel('Wayfair MDN')).toBe(true);
    expect(isWayfairChannel('wayfair x')).toBe(true);
  });
  it('Wayfair olmayanlar → false', () => {
    expect(isWayfairChannel('Ama_US')).toBe(false);
    expect(isWayfairChannel('Etsy_BMU')).toBe(false);
    expect(isWayfairChannel(null)).toBe(false);
  });
});

describe('Wayfair routing → US-only (cgAvail=undefined)', () => {
  it('heavy Wayfair siparişi CG yerine US deposuna düşer', () => {
    const heavy = [{ iwasku: 'A', qty: 1, category: 'Mobilya', desi: 10 }];
    const usAvail = new Map([['A', { NJ: 5, SHOWROOM: 5 }]]);
    const cgAvail = new Map([['A', { CG_SHUKRAN: 99, CG_MDN: 99 }]]);
    // cgAvail verilirse CG'ye giderdi:
    expect(resolveOrderWarehouse(heavy, usAvail, cgAvail as never)).toBe('CG_SHUKRAN');
    // Wayfair'de cgAvail=undefined → US:
    expect(resolveOrderWarehouse(heavy, usAvail, undefined)).toBe('SHOWROOM');
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
