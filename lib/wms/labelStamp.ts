/**
 * Kargo etiketi stamp — etiketin üstüne sipariş/ürün bilgisi şeridi basar.
 *
 * Kargo ekibi eşleştirme için elle iwasku/FNSKU yazıyordu; bunu otomatikleştirir.
 * 4×6 ebadını KORUR (termal yazıcı uyumlu): orijinal etiket ~%87 küçültülüp
 * altta gömülür, üste temiz bir şerit eklenir. Kargo firması fark etmez
 * (UPS/USPS/FedEx) — etiket içeriği analiz edilmez, hiçbir şey örtülmez.
 *
 * Türkçe: standart font ş/ğ/ı/İ basamaz → güvenli karşılığa çevrilir (ç/ü/ö basılır).
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { normalizeLabelPdf } from './labelNormalize';

const winAnsiSafe = (s: string): string =>
  s.replace(/[şŞğĞıİ]/g, (c) => ({ ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I' }[c] ?? c));

export interface LabelStampInfo {
  /** Üstte basılacak kodlar — örn. ["IM1830004T0D (B0BS6HV9L5)", "CA041C0GMFJ5"] */
  codes: string[];
  /** Operatör notu (opsiyonel) — örn. "2 ürün streçlenecek" */
  note?: string | null;
}

/**
 * PDF etiketin her sayfasına üst şerit basar; ebat değişmez.
 * Sadece PDF'lerde kullanılmalı (çağıran mimeType kontrol etmeli).
 */
export async function stampLabelPdf(
  srcBytes: Uint8Array | Buffer,
  info: LabelStampInfo
): Promise<Uint8Array> {
  // Yan/boş gelen etiketleri (FedEx Letter arşivi gibi) önce dik 4×6'ya çevir.
  // Zaten düzgün gelen 4×6 etiketler aynen korunur.
  const { bytes: normalized } = await normalizeLabelPdf(srcBytes);

  const src = await PDFDocument.load(normalized, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const fontB = await out.embedFont(StandardFonts.HelveticaBold);
  const font = await out.embedFont(StandardFonts.Helvetica);

  const note = info.note ? winAnsiSafe(info.note).trim() : '';
  const codeLine = info.codes.map((c) => winAnsiSafe(c).trim()).filter(Boolean).join('   ') || '—';

  for (const srcPage of src.getPages()) {
    const { width, height } = srcPage.getSize();
    const band = note ? 56 : 38;
    const labelH = height - band;
    const scale = labelH / height;
    const labelW = width * scale;
    const xOff = (width - labelW) / 2;

    const embedded = await out.embedPage(srcPage);
    const page = out.addPage([width, height]); // ebat sabit
    page.drawPage(embedded, { x: xOff, y: 0, width: labelW, height: labelH });

    // üst şerit
    page.drawRectangle({ x: 0, y: labelH, width, height: band, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: labelH, width, height: 1.2, color: rgb(0, 0, 0) });

    // kod satırı — sığması için gerekirse küçült
    let size = 16;
    while (size > 8 && fontB.widthOfTextAtSize(codeLine, size) > width - 16) size -= 1;
    page.drawText(codeLine, {
      x: 10,
      y: note ? height - 22 : labelH + band / 2 - 4,
      size,
      font: fontB,
      color: rgb(0, 0, 0),
    });

    if (note) {
      let line = `Not: ${note}`;
      while (font.widthOfTextAtSize(line, 11) > width - 16 && line.length > 8) {
        line = line.slice(0, -2);
      }
      if (line !== `Not: ${note}`) line += '…';
      page.drawText(line, { x: 10, y: height - 42, size: 11, font, color: rgb(0.15, 0.15, 0.15) });
    }
  }

  return out.save();
}

/** Bir kalem listesinden stamp kod satırlarını üretir: "iwasku (FNSKU)" / "iwasku". */
export function buildLabelCodes(
  items: Array<{ iwasku: string; fnsku?: string | null }>
): string[] {
  return items.map((it) => (it.fnsku ? `${it.iwasku} (${it.fnsku})` : it.iwasku));
}
