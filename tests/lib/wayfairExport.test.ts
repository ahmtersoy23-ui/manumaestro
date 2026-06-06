import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseAddressNote, buildMcfWorkbook, CG_RETAILER_ID, type ExportRow } from '@/lib/wisersell/wayfairExport';

describe('parseAddressNote', () => {
  // approve buildAddressNote: labelBase \n recipient \n ship_address(çok satır) \n ürün adları
  it('gerçek CG vakası (113-3939298-5619414) — isim/adres/şehir/eyalet/zip/telefon ayrıştırır', () => {
    const note = [
      'S_UPPUS123',
      'Michael Jay Peterson',
      '1220 Mayfair Drive',
      'Watertown SD 57201',
      '+1602-671-6610',
      '3D Faux Brick Wall Panels - 9 Pack',
    ].join('\n');
    const a = parseAddressNote(note);
    expect(a.name).toBe('Michael Jay Peterson');
    expect(a.address1).toBe('1220 Mayfair Drive');
    expect(a.city).toBe('Watertown');
    expect(a.state).toBe('SD');
    expect(a.postalCode).toBe('57201');
    expect(a.phone).toBe("'+1602-671-6610");
  });

  it('çok-kelimeli şehir + 2 harf eyalet + ZIP+4 (gerçek Wisersell formatı)', () => {
    const note = ['Deborah Williams', '50 W 131ST ST APT 6J', 'NEW YORK NY 10037-3556', '+1 213-442-1463'].join('\n');
    const a = parseAddressNote(note);
    expect(a.city).toBe('NEW YORK');
    expect(a.state).toBe('NY');
    expect(a.postalCode).toBe('10037-3556');
  });

  it('tek-kelime tam eyalet adını 2 harfe çevirir', () => {
    const note = ['Jane Doe', '123 Main St', 'Baton Rouge Louisiana 70801', '+1 555-000-1111'].join('\n');
    expect(parseAddressNote(note).state).toBe('LA');
  });

  it('boş/null güvenli', () => {
    expect(parseAddressNote(null).name).toBeNull();
    expect(parseAddressNote('').city).toBeNull();
  });
});

describe('buildMcfWorkbook', () => {
  const row: ExportRow = {
    retailerId: CG_RETAILER_ID.CG_SHUKRAN,
    poNumber: '113-3939298-5619414',
    orderNumber: '113-3939298-5619414',
    partNumber: 'AHM69BABYLON',
    quantity: 2,
    name: 'Michael Jay Peterson',
    address1: '1220 Mayfair Drive',
    city: 'Watertown',
    state: 'SD',
    postalCode: '57201',
    country: 'US',
    phone: "'+1602-671-6610",
    email: 'test@example.com',
  };

  it('Retailer ID = 27348 (Shukran), Fulfillment Warehouse ID boş, doğru kolon hizası', () => {
    const buf = buildMcfWorkbook([row]);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['Order Import Template'], { header: 1 });
    const header = aoa[0];
    const data = aoa[1];
    expect(header[0]).toBe('Retailer ID');
    expect(header[4]).toBe('Part Number');
    expect(header[6]).toBe('Fulfillment Warehouse ID');
    expect(data[0]).toBe(27348);
    expect(data[1]).toBe('113-3939298-5619414');
    expect(data[4]).toBe('AHM69BABYLON');
    expect(data[5]).toBe(2);
    expect(data[6]).toBe(''); // Fulfillment Warehouse ID boş
    expect(data[11]).toBe('Michael Jay Peterson'); // Shipping Name
    expect(data[15]).toBe('SD'); // Shipping State
    expect(data[17]).toBe('US'); // Shipping Country
  });

  it('Shipping Name 30, Address1 35 karakterde kırpılır', () => {
    const long: ExportRow = { ...row, name: 'X'.repeat(50), address1: 'Y'.repeat(50) };
    const buf = buildMcfWorkbook([long]);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['Order Import Template'], { header: 1 });
    expect((aoa[1][11] as string).length).toBe(30);
    expect((aoa[1][12] as string).length).toBe(35);
  });
});
