import { describe, it, expect } from 'vitest';
import { parseShipAddress, parseAddressNote } from '@/lib/veeqo/orderAddress';

describe('parseShipAddress', () => {
  it('3-satır US blob (51218 örneği) temiz parse', () => {
    const r = parseShipAddress('Sabila Newaz', '208 Community Circle\nOld Bridge NJ 08857\n8326160133');
    expect(r).toMatchObject({
      name: 'Sabila Newaz',
      line1: '208 Community Circle',
      town: 'Old Bridge',
      county: 'NJ',
      postcode: '08857',
      country_code: 'US',
      phone: '8326160133',
      parsed: true,
    });
  });

  it('çok-kelimeli şehir + ZIP+4', () => {
    const r = parseShipAddress('John Doe', '12 Main St\nSan Luis Obispo CA 93401-1234\n5551234567');
    expect(r.town).toBe('San Luis Obispo');
    expect(r.county).toBe('CA');
    expect(r.postcode).toBe('93401-1234');
    expect(r.parsed).toBe(true);
  });

  it('çok satırlı sokak → line1 birleştirilir', () => {
    const r = parseShipAddress('A', 'Apt 5\n100 Oak Ave\nBoston MA 02101\n6175551212');
    expect(r.line1).toBe('Apt 5, 100 Oak Ave');
    expect(r.town).toBe('Boston');
    expect(r.parsed).toBe(true);
  });

  it('telefon yoksa', () => {
    const r = parseShipAddress('A', '5 Elm St\nMiami FL 33101');
    expect(r.phone).toBeUndefined();
    expect(r.postcode).toBe('33101');
    expect(r.parsed).toBe(true);
  });

  it('city/state/zip parse edilemezse parsed=false (operatör düzeltir)', () => {
    const r = parseShipAddress('A', '44 Waterville Place\nTHORNLANDS QLD 4164 Australia');
    expect(r.parsed).toBe(false); // ABD formatı değil
  });

  it('isim yoksa Customer fallback', () => {
    const r = parseShipAddress(null, '1 A St\nNYC NY 10001');
    expect(r.name).toBe('Customer');
  });

  it('virgüllü şehir "Scranton, PA 18508" → town virgülsüz', () => {
    const r = parseShipAddress('Manum Jan', '1008 Ravine St\nScranton, PA 18508\n(570) 604-3683');
    expect(r).toMatchObject({ line1: '1008 Ravine St', town: 'Scranton', county: 'PA', postcode: '18508', parsed: true });
  });
});

describe('parseAddressNote (manuel sipariş addressNote fallback)', () => {
  it('isim-ilk-satır formatını parse eder (Walmart manuel vakası)', () => {
    const r = parseAddressNote('Manum Jan\n1008 Ravine St\nScranton, PA 18508\n(570) 604-3683');
    expect(r).toMatchObject({
      name: 'Manum Jan', line1: '1008 Ravine St', town: 'Scranton', county: 'PA', postcode: '18508', parsed: true,
    });
  });

  it('yalnız isim (adres yok) → null', () => {
    expect(parseAddressNote('kamrun imam')).toBeNull();
  });

  it('boş/null → null', () => {
    expect(parseAddressNote(null)).toBeNull();
    expect(parseAddressNote('')).toBeNull();
  });
});
