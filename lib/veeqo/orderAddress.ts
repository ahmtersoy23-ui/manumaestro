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

/** "Old Bridge NJ 08857" / "Scranton, PA 18508" → { town, county, postcode } (US formatı). */
function parseCityStateZip(line: string): { town: string; county: string; postcode: string } | null {
  const m = line.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!m) return null;
  // "Scranton, PA" gibi şehir-sonu virgül/boşluk temizle (manuel girişte yaygın).
  return { town: m[1].trim().replace(/[,\s]+$/, ''), county: m[2].toUpperCase(), postcode: m[3] };
}

/**
 * Serbest-metin ship_address blob'unu yapısal adrese çevirir (saf — test edilir).
 * Pozisyona GÜVENMEZ: "Şehir EYALET ZIP" satırını TÜM satırlarda tarar (telefon satırında
 * sondaki '*', ülke eki vb. olabilir → eski "son satır = csz" varsayımı postcode'u boş
 * bırakıyordu). Telefon = harf içermeyen, ≥7 rakamlı satır; geri kalan = sokak.
 */
export function parseShipAddress(name: string | null, raw: string): ParsedShipTo {
  const lines = raw.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);

  // Telefon: harf yok + en az 7 rakam ("(570) 604-3683*" gibi kirli sonları tolere et).
  const isPhone = (s: string) => !/[A-Za-z]/.test(s) && s.replace(/\D/g, '').length >= 7;

  let csz: { town: string; county: string; postcode: string } | null = null;
  let phone: string | undefined;
  const street: string[] = [];
  for (const ln of lines) {
    if (!csz) {
      const c = parseCityStateZip(ln);
      if (c) { csz = c; continue; }
    }
    if (!phone && isPhone(ln)) { phone = ln.replace(/[^\d+]/g, ''); continue; }
    street.push(ln);
  }

  const line1 = (street.join(', ') || lines[0] || '').trim();
  const town = csz?.town ?? '';
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

/**
 * MANUAL siparişin `addressNote`'undan adres çıkarır (Wisersell candidate yok → fallback).
 * Operatör girişte ilk satır = alıcı adı, kalan = sokak / "Şehir EYALET ZIP" / telefon yazar.
 * Sadece isim (adres satırı yok) → null (modal operatöre boş form açar).
 */
export function parseAddressNote(note: string | null): ParsedShipTo | null {
  if (!note) return null;
  const lines = note.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null; // yalnız isim ya da boş → adres yok
  return parseShipAddress(lines[0], lines.slice(1).join('\n'));
}
