import { describe, expect, it } from 'vitest';
import {
  PDFDocument,
  PDFName,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  drawObject,
} from 'pdf-lib';
import { analyzeLabelPdf, normalizeLabelPdf } from '@/lib/wms/labelNormalize';

async function blankPage(w: number, h: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([w, h]);
  return doc.save();
}

/**
 * Letter sayfaya 90° döndürülmüş, 2:3 oranlı tek görsel koyar (FedEx arşiv taklidi).
 * Görsel XObject elle enjekte edilir — piksel verisi/çözümleme gerekmez; detektör
 * yalnızca /Subtype /Image + yerleşim CTM'ine bakar.
 * CTM [0 288 -432 0 522 432] = 4×6 görseli 90° dönük üst-orta yerleşim.
 */
async function letterWithRotatedLabel(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const stream = doc.context.stream(new Uint8Array([0]), {
    Type: 'XObject',
    Subtype: 'Image',
    Width: 800,
    Height: 1200,
    ColorSpace: 'DeviceGray',
    BitsPerComponent: 8,
  });
  const ref = doc.context.register(stream);
  page.node.setXObject(PDFName.of('Im0'), ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(0, 288, -432, 0, 522, 432),
    drawObject('Im0'),
    popGraphicsState()
  );
  return doc.save();
}

describe('labelNormalize — 4×6 etiket normalize', () => {
  it('zaten 4×6 gelen etiket → ok (dokunulmaz)', async () => {
    const bytes = await blankPage(288, 432);
    const a = await analyzeLabelPdf(bytes);
    expect(a.kind).toBe('ok');

    const { bytes: out } = await normalizeLabelPdf(bytes);
    // ok ise orijinal aynen döner
    expect(out.byteLength).toBe(bytes.byteLength);
  });

  it('Letter + tek 2:3 dönük görsel → fixed, çıktı 288×432 olur', async () => {
    const bytes = await letterWithRotatedLabel();
    const a = await analyzeLabelPdf(bytes);
    expect(a.kind).toBe('fixed');

    const { bytes: out, analysis } = await normalizeLabelPdf(bytes);
    expect(analysis.kind).toBe('fixed');
    const doc = await PDFDocument.load(out);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(288);
    expect(Math.round(height)).toBe(432);
  });

  it('Letter + görsel yok → unknown (dokunulmaz, uyarı döner)', async () => {
    const bytes = await blankPage(612, 792);
    const a = await analyzeLabelPdf(bytes);
    expect(a.kind).toBe('unknown');
    expect(a.message).toBeTruthy();

    const { bytes: out } = await normalizeLabelPdf(bytes);
    expect(out.byteLength).toBe(bytes.byteLength); // dönüştürülmez
  });
});
