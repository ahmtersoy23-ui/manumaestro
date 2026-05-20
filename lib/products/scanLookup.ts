/**
 * Tek bir taranan/girilen kodu IWASKU'ya çevirir.
 * Sıra: FNSKU (sku_master.fnsku) → IWASKU (products.product_sku).
 * EAN ileride eklenecek (sku_master veya yeni product_barcodes tablosu).
 */

import { queryProductDb } from '@/lib/db/prisma';

export type ScanFoundBy = 'serial' | 'fnsku' | 'iwasku' | 'asin' | 'ean';

export interface ScanLookupResult {
  iwasku: string;
  name: string | null;
  category: string | null;
  foundBy: ScanFoundBy;
  fnsku: string | null;
  /** Sadece serial taramalarda — etiketin tam barkodu (örn. SCS0120VQKBY-000001) */
  serial: string | null;
}

// Manu üretim etiketi formatı: <IWASKU>-NNNNNN (6 haneli sayaç)
// Bkz. lib/serial/generate.ts
const SERIAL_RE = /^(.+)-(\d{6})$/;

export async function lookupByScan(code: string): Promise<ScanLookupResult | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  // 0) Manu seri etiketi (IWASKU-NNNNNN) — direkt IWASKU çöz, miktar zorunlu olarak 1
  const serialMatch = SERIAL_RE.exec(trimmed);
  if (serialMatch) {
    const iwaskuFromSerial = serialMatch[1];
    const detail = await fetchIwaskuDetail(iwaskuFromSerial);
    if (detail) {
      const fnsku = await fetchFirstFnsku(iwaskuFromSerial);
      return {
        iwasku: iwaskuFromSerial,
        name: detail.name,
        category: detail.category,
        foundBy: 'serial',
        fnsku,
        serial: trimmed,
      };
    }
    // Serial gibi görünen ama prefix IWASKU değilse devam et — alttaki fallback'lere düş
  }

  // 1) FNSKU eşleşmesi (sku_master)
  const fnskuRows = (await queryProductDb(
    `SELECT iwasku FROM sku_master WHERE fnsku = $1 LIMIT 1`,
    [trimmed],
  )) as Array<{ iwasku: string }>;
  if (fnskuRows.length > 0) {
    const iwasku = fnskuRows[0].iwasku;
    const detail = await fetchIwaskuDetail(iwasku);
    return {
      iwasku,
      name: detail?.name ?? null,
      category: detail?.category ?? null,
      foundBy: 'fnsku',
      fnsku: trimmed,
      serial: null,
    };
  }

  // 2) IWASKU eşleşmesi (products.product_sku)
  const productRows = (await queryProductDb(
    `SELECT product_sku, name, category FROM products WHERE product_sku = $1 LIMIT 1`,
    [trimmed],
  )) as Array<{ product_sku: string; name: string | null; category: string | null }>;
  if (productRows.length > 0) {
    const iwasku = productRows[0].product_sku;
    const fnsku = await fetchFirstFnsku(iwasku);
    return {
      iwasku,
      name: productRows[0].name,
      category: productRows[0].category,
      foundBy: 'iwasku',
      fnsku,
      serial: null,
    };
  }

  // 3) ASIN eşleşmesi (sku_master.asin) — manufacturer barcode'lar (B...) FNSKU'da yoksa
  // bazen direkt ASIN olarak basılmış olabilir
  const asinRows = (await queryProductDb(
    `SELECT iwasku FROM sku_master WHERE asin = $1 LIMIT 1`,
    [trimmed],
  )) as Array<{ iwasku: string }>;
  if (asinRows.length > 0) {
    const iwasku = asinRows[0].iwasku;
    const detail = await fetchIwaskuDetail(iwasku);
    const fnsku = await fetchFirstFnsku(iwasku);
    return {
      iwasku,
      name: detail?.name ?? null,
      category: detail?.category ?? null,
      foundBy: 'asin',
      fnsku,
      serial: null,
    };
  }

  // 4) EAN — şimdilik tabloda yok, ileride eklenecek
  return null;
}

async function fetchIwaskuDetail(iwasku: string) {
  const rows = (await queryProductDb(
    `SELECT name, category FROM products WHERE product_sku = $1 LIMIT 1`,
    [iwasku],
  )) as Array<{ name: string | null; category: string | null }>;
  return rows[0] ?? null;
}

async function fetchFirstFnsku(iwasku: string): Promise<string | null> {
  const rows = (await queryProductDb(
    `SELECT fnsku FROM sku_master WHERE iwasku = $1 AND fnsku IS NOT NULL LIMIT 1`,
    [iwasku],
  )) as Array<{ fnsku: string }>;
  return rows[0]?.fnsku ?? null;
}
