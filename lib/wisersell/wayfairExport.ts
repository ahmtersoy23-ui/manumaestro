/**
 * CG (CastleGate) sipariş → Wayfair MCF "Order Import Template" Excel üretimi.
 *
 * Faz 3 (A): "CG Bekliyor" kovasındaki DRAFT outbound order'lar seçilip Wayfair'in
 * Order Import Template formatında Excel'e basılır; Wayfair operatörü bununla MCF girişi yapar.
 *
 * Net çözülen eşlemeler:
 *  - Hesap → Retailer ID:  CG_SHUKRAN=27348, CG_MDN=38104  (Fulfillment Warehouse ID BOŞ)
 *  - iwasku → Part Number: databridge_db.wayfair_sku_mapping (reverse, kanonik seçim);
 *    kanonik = wayfair_inventory'de canlı satırı olan part (eski *WALLPANEL alias'lar elenir).
 */

import * as XLSX from 'xlsx';
import { queryDataBridge } from '@/lib/db/prisma';

/** warehouseCode → Wayfair Retailer ID (mağaza/hesap). */
export const CG_RETAILER_ID: Record<string, number> = {
  CG_SHUKRAN: 27348,
  CG_MDN: 38104,
};

export const CG_ACCOUNT_LABEL: Record<string, string> = {
  CG_SHUKRAN: 'Shukran',
  CG_MDN: 'MDN',
};

export interface PartResolution {
  partNumber: string | null;
  candidates: string[];
}

/**
 * iwasku listesi → kanonik Wayfair part number.
 * Kanonik kural: wayfair_inventory'de en çok satırı olan part (canlı listing) önce;
 * eşitlikte toplam stok, sonra en güncel mapping, sonra alfabetik.
 */
export async function resolveWayfairPartNumbers(iwaskus: string[]): Promise<Map<string, PartResolution>> {
  const uniq = [...new Set(iwaskus.filter(Boolean))];
  const out = new Map<string, PartResolution>();
  if (!uniq.length) return out;

  const rows = (await queryDataBridge(
    `SELECT m.iwasku,
            m.part_number,
            COALESCE(inv.rows, 0)::int AS inv_rows,
            COALESCE(inv.qty, 0)::int  AS inv_qty,
            m.updated_at
       FROM wayfair_sku_mapping m
       LEFT JOIN (
         SELECT part_number, COUNT(*) AS rows, SUM(quantity) AS qty
           FROM wayfair_inventory GROUP BY part_number
       ) inv ON inv.part_number = m.part_number
      WHERE m.iwasku = ANY($1::text[])`,
    [uniq],
  )) as Array<{ iwasku: string; part_number: string; inv_rows: number; inv_qty: number; updated_at: string | null }>;

  const byIwasku = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byIwasku.get(r.iwasku) ?? [];
    list.push(r);
    byIwasku.set(r.iwasku, list);
  }

  for (const iwasku of uniq) {
    const cands = byIwasku.get(iwasku) ?? [];
    if (!cands.length) {
      out.set(iwasku, { partNumber: null, candidates: [] });
      continue;
    }
    cands.sort((a, b) => {
      if (a.inv_rows !== b.inv_rows) return b.inv_rows - a.inv_rows; // canlı listing önce
      if (a.inv_qty !== b.inv_qty) return b.inv_qty - a.inv_qty;
      const at = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bt = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      if (at !== bt) return bt - at;
      return a.part_number.localeCompare(b.part_number);
    });
    out.set(iwasku, { partNumber: cands[0].part_number, candidates: cands.map((c) => c.part_number) });
  }
  return out;
}

export interface ParsedAddress {
  name: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
}

/** ABD eyalet tam adı → 2 harf (en sık karşılaşılanlar; zaten 2 harf ise olduğu gibi döner). */
const STATE_ABBR: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO',
  CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID',
  ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA',
  MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR',
  PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC',
};

const STATE_FULL_NAMES = Object.keys(STATE_ABBR).sort((a, b) => b.length - a.length); // uzun ad önce

/**
 * "City ST ZIP" / "City Full State Name ZIP" satırını ZIP'i sağ-çapa alarak böler.
 * Önce tam eyalet adı (satır sonundaysa), sonra 2 harf eyalet denenir — çok-kelimeli
 * şehir + 2 harf eyalet (gerçek Wisersell formatı: "NEW YORK NY 10037-3556") doğru ayrışır.
 */
function splitCityStateZip(line: string): { city: string | null; state: string; postalCode: string } | null {
  const zipM = line.match(/(\d{5}(?:-\d{4})?)\s*$/);
  if (!zipM || zipM.index == null) return null;
  const postalCode = zipM[1];
  const rest = line.slice(0, zipM.index).replace(/[,\s]+$/, '').trim();
  const restUp = rest.toUpperCase();

  for (const fn of STATE_FULL_NAMES) {
    if (restUp === fn || restUp.endsWith(' ' + fn)) {
      const city = rest.slice(0, rest.length - fn.length).replace(/[,\s]+$/, '').trim();
      return { city: city || null, state: STATE_ABBR[fn], postalCode };
    }
  }
  const twoM = rest.match(/\b([A-Za-z]{2})$/);
  if (twoM && twoM.index != null) {
    const city = rest.slice(0, twoM.index).replace(/[,\s]+$/, '').trim();
    return { city: city || null, state: twoM[1].toUpperCase(), postalCode };
  }
  return null;
}

/** Telefonu Wayfair biçimine getirir: başına ', ext varsa /ext. Boşsa null. */
function formatPhone(raw: string): string | null {
  const t = raw.trim();
  if (!t || /^yok$/i.test(t)) return null;
  // "+1 314-282-9402/81711" gibi; başına ' (Excel'in sayı sanmaması için)
  return t.startsWith("'") ? t : `'${t}`;
}

/**
 * approve sırasında üretilen addressNote'u parse eder.
 * Biçim (buildAddressNote): labelBase \n recipient_name \n ship_address(çok satır) \n ürün adları
 * ship_address tipik: "1220 Mayfair Drive\nWatertown SD 57201\n+1602-671-6610"
 * Heuristik: ZIP'li satır = "City ST ZIP"; ondan önceki ilk satır = adres; telefon = +/rakam ağırlıklı satır;
 * isim = recipient (ürün adları/label hariç ilk satır).
 */
export function parseAddressNote(note: string | null): ParsedAddress {
  const empty: ParsedAddress = { name: null, address1: null, city: null, state: null, postalCode: null, phone: null };
  if (!note) return empty;
  const lines = note.split(/\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return empty;

  // City ST ZIP satırı (ZIP sağ-çapa). State 2 harf veya tam ad.
  let cszIdx = -1;
  let city: string | null = null, state: string | null = null, postalCode: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const csz = splitCityStateZip(lines[i]);
    if (csz) {
      city = csz.city;
      state = csz.state;
      postalCode = csz.postalCode;
      cszIdx = i;
      break;
    }
  }

  // Telefon satırı: + ile başlar veya çoğunlukla rakam/-/boşluk.
  let phone: string | null = null;
  let phoneIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\+?\d[\d\s\-/().]{6,}$/.test(l) || /^\+\d/.test(l)) {
      phone = formatPhone(l);
      phoneIdx = i;
      break;
    }
  }

  // Adres1 = ZIP satırından hemen önceki satır (varsa); değilse 2. satır.
  let address1: string | null = null;
  if (cszIdx > 0) address1 = lines[cszIdx - 1];
  else if (lines.length >= 2) address1 = lines[1];

  // İsim = ilk satır; ama label_no (kısa alfasayısal kod, boşluksuz) olabilir → adres/zip/telefon değilse al.
  // recipient genelde ad-soyad (boşluklu). Label satırı tek token + rakam karışık olur.
  let name: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (i === cszIdx || i === phoneIdx) continue;
    if (address1 && lines[i] === address1) continue;
    const l = lines[i];
    // ad-soyad: en az bir boşluk + büyük oranda harf
    if (/[A-Za-zÀ-ÿ].*\s.*[A-Za-zÀ-ÿ]/.test(l) && !/\d{4,}/.test(l)) { name = l; break; }
  }
  if (!name) {
    // fallback: ilk satır (label olsa bile operatör düzeltir)
    name = lines.find((l, i) => i !== cszIdx && i !== phoneIdx && l !== address1) ?? lines[0];
  }

  return { name, address1, city, state, postalCode, phone };
}

export interface CgExportItem {
  iwasku: string;
  quantity: number;
}
export interface CgExportOrder {
  orderNumber: string;
  warehouseCode: string; // CG_SHUKRAN | CG_MDN
  addressNote: string | null;
  items: CgExportItem[];
}

export interface ExportRow {
  retailerId: number;
  poNumber: string;
  orderNumber: string;
  partNumber: string;
  quantity: number;
  name: string;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
}

const TEMPLATE_HEADER = [
  'Retailer ID', 'Retailer PO Number', 'Retailer Order Number', 'Recipient Order Number',
  'Part Number', 'Quantity', 'Fulfillment Warehouse ID', 'Shipping Account Number', 'SCAC Code',
  'Ship Speed', 'Delivery Signature Required', 'Shipping Name', 'Shipping Address 1',
  'Shipping Address 2', 'Shipping City', 'Shipping State', 'Shipping Postal Code', 'Shipping Country',
  'Shipping Phone Number', 'Shipping Email', 'Billing Name', 'Billing Address 1', 'Billing Address 2',
  'Billing City', 'Billing State', 'Billing Postal Code', 'Billing Country',
];

function clip(s: string | null, max: number): string {
  return (s ?? '').slice(0, max);
}

/** Tek hesabın satırlarını Order Import Template biçiminde xlsx Buffer'a basar (tek "Order Import Template" sheet). */
export function buildMcfWorkbook(rows: ExportRow[]): Buffer {
  const aoa: (string | number)[][] = [TEMPLATE_HEADER];
  for (const r of rows) {
    aoa.push([
      r.retailerId, r.poNumber, r.orderNumber, '',
      r.partNumber, r.quantity, '', '', '',
      '', '', clip(r.name, 30), clip(r.address1, 35),
      '', r.city, r.state, r.postalCode, r.country,
      r.phone, r.email, '', '', '',
      '', '', '', '',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Order Import Template');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
