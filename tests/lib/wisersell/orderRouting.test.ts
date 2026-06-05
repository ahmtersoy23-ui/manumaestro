import { describe, it, expect } from 'vitest';
import { resolveOrderWarehouse } from '@/lib/wisersell/orderRouting';
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
