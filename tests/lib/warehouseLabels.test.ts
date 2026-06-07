import { describe, it, expect } from 'vitest';
import {
  warehouseLabel,
  warehouseLabelLong,
  slugToCode,
  codeToSlug,
  isLegacyCode,
} from '@/lib/warehouseLabels';

describe('warehouseLabel / Long', () => {
  it('bilinen kodlar kullanıcı-dostu isme döner', () => {
    expect(warehouseLabel('NJ')).toBe('Somerset');
    expect(warehouseLabel('SHOWROOM')).toBe('Fairfield');
    expect(warehouseLabel('ANKARA')).toBe('Ankara');
    expect(warehouseLabelLong('NJ')).toBe('Somerset Depo');
  });
  it('bilinmeyen kod fallback olarak kendini döner', () => {
    expect(warehouseLabel('NL')).toBe('NL');
    expect(warehouseLabelLong('XYZ')).toBe('XYZ');
  });
});

describe('slug ↔ code', () => {
  it('slug → code (case-insensitive)', () => {
    expect(slugToCode('somerset')).toBe('NJ');
    expect(slugToCode('Fairfield')).toBe('SHOWROOM');
    expect(slugToCode('ANKARA')).toBe('ANKARA');
  });
  it('bilinmeyen slug → null', () => {
    expect(slugToCode('berlin')).toBeNull();
  });
  it('code → slug (yoksa lowercase fallback)', () => {
    expect(codeToSlug('NJ')).toBe('somerset');
    expect(codeToSlug('showroom')).toBe('fairfield'); // case-insensitive
    expect(codeToSlug('NL')).toBe('nl'); // fallback
  });
  it('round-trip code → slug → code', () => {
    for (const code of ['ANKARA', 'NJ', 'SHOWROOM']) {
      expect(slugToCode(codeToSlug(code))).toBe(code);
    }
  });
});

describe('isLegacyCode', () => {
  it('büyük-harf backend kodu → legacy', () => {
    expect(isLegacyCode('NJ')).toBe(true);
    expect(isLegacyCode('SHOWROOM')).toBe(true);
  });
  it('slug ya da bilinmeyen → legacy değil', () => {
    expect(isLegacyCode('somerset')).toBe(false);
    expect(isLegacyCode('NL')).toBe(false); // CODE_TO_SLUG'da yok
  });
});
