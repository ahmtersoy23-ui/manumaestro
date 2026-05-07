/**
 * Raf etiketi PDF üretir (client-side).
 * Her etiket A6'ya sığar: büyük kod + tip + depo adı + QR kodu (raf code'u).
 *
 * Tek raf veya toplu (her etiket ayrı sayfa) destekler. PDF Blob döner;
 * caller indirme / yeni sekmede açma yapar.
 *
 * Bağımlılıklar zaten projede: pdf-lib, qrcode.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { warehouseLabel } from '@/lib/warehouseLabels';

export interface ShelfLabelInput {
  code: string;
  shelfType: string;
  warehouseCode: string;
}

const TYPE_LABEL: Record<string, string> = {
  POOL: 'HAVUZ',
  TEMP: 'GECICI',
  NORMAL: 'NORMAL',
};

export async function generateShelfLabelsPdf(shelves: ShelfLabelInput[]): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // A6 portrait: 297.64 x 419.53 pt
  const W = 297.64;
  const H = 419.53;
  const margin = 18;

  for (const sh of shelves) {
    const page = pdf.addPage([W, H]);

    // QR kodu üret (PNG dataURL → bytes)
    const qrDataUrl = await QRCode.toDataURL(sh.code, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 360,
    });
    const qrBytes = Uint8Array.from(
      atob(qrDataUrl.split(',')[1]),
      (c) => c.charCodeAt(0)
    );
    const qrImage = await pdf.embedPng(qrBytes);
    const qrSize = 200;

    // Üst: depo adı + tip
    page.drawText(warehouseLabel(sh.warehouseCode), {
      x: margin,
      y: H - margin - 18,
      size: 14,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    page.drawText(TYPE_LABEL[sh.shelfType] ?? sh.shelfType, {
      x: W - margin - 60,
      y: H - margin - 18,
      size: 12,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });

    // Orta: büyük raf kodu
    const codeFontSize = sh.code.length > 12 ? 28 : sh.code.length > 8 ? 36 : 48;
    const codeWidth = fontBold.widthOfTextAtSize(sh.code, codeFontSize);
    page.drawText(sh.code, {
      x: (W - codeWidth) / 2,
      y: H - margin - 70,
      size: codeFontSize,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    // Alt: QR ortalanmış
    page.drawImage(qrImage, {
      x: (W - qrSize) / 2,
      y: margin + 30,
      width: qrSize,
      height: qrSize,
    });

    // Footer ipucu
    page.drawText('Tarayici / kamera ile okutun', {
      x: margin,
      y: margin + 8,
      size: 9,
      font,
      color: rgb(0.6, 0.6, 0.6),
    });
  }

  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Yardımcı: PDF Blob'u indir veya yeni sekmede aç.
 */
export function downloadPdf(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
