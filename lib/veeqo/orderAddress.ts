/**
 * Amazon-DIŞI (standalone) Veeqo etiketi için alıcı adresi kaynağı.
 *
 * Amazon siparişleri Veeqo'ya senkron akar → adresi Veeqo'dan (deliver_to) gelir.
 * Amazon-dışı (Shopify/Etsy/...) Veeqo'da YOK → adresi BİZ besleriz:
 * `wisersell_routing_candidates.ship_address` (DataBridge) tek serbest-metin blob:
 *
 *   208 Community Circle
 *   Old Bridge NJ 08857
 *   8326160133
 *
 * 3 satır: sokak / "Şehir EYALET ZIP" / telefon. Parse best-effort; serbest metin
 * olduğundan `parsed=false` ise modal operatöre düzenlettirir (yanlış adres = kayıp paket).
 */

import { queryDataBridge } from '@/lib/db/prisma';

export interface ParsedShipTo {
  name: string;
  line1: string;
  town: string;
  /** US state (2 harf) — yoksa boş */
  county: string;
  postcode: string;
  country_code: string;
  phone?: string;
  /** Güvenilir parse oldu mu? false → modalda uyarı + zorunlu kontrol */
  parsed: boolean;
  /** Ham blob — operatör görsün/karşılaştırsın */
  raw: string;
}

/** "Old Bridge NJ 08857" → { town, county, postcode } (US formatı). */
function parseCityStateZip(line: string): { town: string; county: string; postcode: string } | null {
  const m = line.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!m) return null;
  return { town: m[1].trim(), county: m[2].toUpperCase(), postcode: m[3] };
}

/**
 * Serbest-metin ship_address blob'unu yapısal adrese çevirir (saf — test edilir).
 * Telefon son satırda (çoğunlukla rakam), city/state/zip ondan önceki satır,
 * geri kalanı sokak.
 */
export function parseShipAddress(name: string | null, raw: string): ParsedShipTo {
  const lines = raw.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);

  let phone: string | undefined;
  const body = [...lines];
  if (body.length > 1 && /^[\d\s()+.\-]{7,}$/.test(body[body.length - 1])) {
    phone = body.pop()!.replace(/[^\d+]/g, '');
  }

  const cszLine = body.length > 0 ? body[body.length - 1] : '';
  const csz = parseCityStateZip(cszLine);
  const streetLines = csz ? body.slice(0, -1) : body.slice(0, Math.max(1, body.length - 1));
  const line1 = (streetLines.join(', ') || lines[0] || '').trim();

  const town = csz?.town ?? cszLine;
  const county = csz?.county ?? '';
  const postcode = csz?.postcode ?? '';
  const parsed = Boolean(line1 && csz && town && postcode);

  return {
    name: (name || 'Customer').trim(),
    line1,
    town,
    county,
    postcode,
    country_code: 'US', // ABD deposundan çıkış; uluslararası ise operatör modalda düzeltir
    phone,
    parsed,
    raw,
  };
}

/**
 * Sipariş no (order_code) ile alıcı adresini DataBridge candidate'ından çekip parse eder.
 * Bulunamazsa null (manuel sipariş ya da candidate temizlenmiş → operatör elle girer).
 */
export async function getOrderShipTo(orderCode: string): Promise<ParsedShipTo | null> {
  const rows = (await queryDataBridge(
    `SELECT recipient_name, ship_address FROM wisersell_routing_candidates WHERE order_code = $1 LIMIT 1`,
    [orderCode],
  )) as Array<{ recipient_name: string | null; ship_address: string | null }>;
  if (!rows.length || !rows[0].ship_address) return null;
  return parseShipAddress(rows[0].recipient_name, rows[0].ship_address);
}
