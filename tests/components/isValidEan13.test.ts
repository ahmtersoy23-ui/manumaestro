import { describe, expect, it } from 'vitest';
import { isValidEan13 } from '@/components/shipments/ConsolidationTab';

describe('isValidEan13 — Fairfield etiket barkod doğrulaması', () => {
  it('geçerli GTIN-13 (doğru kontrol hanesi) → true', () => {
    expect(isValidEan13('8685107002953')).toBe(true);
    expect(isValidEan13('8684089413139')).toBe(true);
  });

  it('yanlış kontrol hanesi → false', () => {
    expect(isValidEan13('8685107002954')).toBe(false);
  });

  it('hane sayısı 13 değil → false', () => {
    expect(isValidEan13('868510700295')).toBe(false); // 12
    expect(isValidEan13('86851070029531')).toBe(false); // 14
  });

  it('rakam dışı / boş → false', () => {
    expect(isValidEan13('868510700295A')).toBe(false);
    expect(isValidEan13('')).toBe(false);
    expect(isValidEan13(null)).toBe(false);
    expect(isValidEan13(undefined)).toBe(false);
  });
});
