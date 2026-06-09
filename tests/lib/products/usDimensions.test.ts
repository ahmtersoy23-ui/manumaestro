import { describe, expect, it } from 'vitest';
import { usDimensions, type ProductInfo } from '@/lib/products/lookup';

const base: ProductInfo = {
  iwasku: 'X',
  name: null,
  category: null,
  asin: null,
  fnsku: null,
  ean: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
  weightKg: null,
  desi: null,
};

describe('usDimensions — cm/kg → inç/libre', () => {
  it('ürün yoksa null', () => {
    expect(usDimensions(null)).toBeNull();
    expect(usDimensions(undefined)).toBeNull();
  });

  it('hiç ölçü yoksa null', () => {
    expect(usDimensions(base)).toBeNull();
  });

  it('cm → inç ve kg → libre (1 ondalık yuvarlama)', () => {
    const r = usDimensions({ ...base, lengthCm: 78, widthCm: 69, heightCm: 3, weightKg: 3.4 });
    expect(r).toEqual({ lengthIn: 30.7, widthIn: 27.2, heightIn: 1.2, weightLb: 7.5 });
  });

  it('kısmi veri: sadece ağırlık', () => {
    const r = usDimensions({ ...base, weightKg: 2 });
    expect(r).toEqual({ lengthIn: null, widthIn: null, heightIn: null, weightLb: 4.4 });
  });
});
