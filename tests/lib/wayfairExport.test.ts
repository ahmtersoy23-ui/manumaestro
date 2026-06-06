import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
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

  const loadOIT = async (buf: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    return wb;
  };
  const cell = (wb: ExcelJS.Workbook, rowNo: number, col: number) => wb.getWorksheet('Order Import Template')!.getRow(rowNo).getCell(col).value;

  it('3 sheet korunur + Retailer ID 27348 (Shukran) + Fulfillment Warehouse ID boş + kolon hizası (data row 6)', async () => {
    const wb = await loadOIT(await buildMcfWorkbook([row]));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Instructions', 'Order Import Template', 'Valid Values']);
    // metadata: kolon adları row 3
    expect(cell(wb, 3, 1)).toBe('Retailer ID');
    expect(cell(wb, 3, 5)).toBe('Part Number');
    expect(cell(wb, 3, 7)).toBe('Fulfillment Warehouse ID');
    // veri: row 6
    expect(cell(wb, 6, 1)).toBe(27348);
    expect(cell(wb, 6, 2)).toBe('113-3939298-5619414');
    expect(cell(wb, 6, 5)).toBe('AHM69BABYLON');
    expect(cell(wb, 6, 6)).toBe(2);
    expect(cell(wb, 6, 7) || '').toBe(''); // Fulfillment Warehouse ID boş
    expect(cell(wb, 6, 12)).toBe('Michael Jay Peterson'); // Shipping Name
    expect(cell(wb, 6, 16)).toBe('SD'); // Shipping State
    expect(cell(wb, 6, 18)).toBe('US'); // Shipping Country
  });

  it('çok satır row 6,7,8… sırasıyla dolar', async () => {
    const wb = await loadOIT(await buildMcfWorkbook([row, { ...row, partNumber: 'AHM69GEMSTONE', quantity: 1 }]));
    expect(cell(wb, 6, 5)).toBe('AHM69BABYLON');
    expect(cell(wb, 7, 5)).toBe('AHM69GEMSTONE');
  });

  it('Shipping Name 30, Address1 35 karakterde kırpılır', async () => {
    const long: ExportRow = { ...row, name: 'X'.repeat(50), address1: 'Y'.repeat(50) };
    const wb = await loadOIT(await buildMcfWorkbook([long]));
    expect((cell(wb, 6, 12) as string).length).toBe(30);
    expect((cell(wb, 6, 13) as string).length).toBe(35);
  });
});
