/**
 * Kargo etiketi normalize — yüklenen PDF'i temiz, dik 4×6 etikete çevirir.
 *
 * Bazı kargo PDF'leri (özellikle FedEx arşiv/Veeqo çıktısı) 8.5×11 Letter
 * sayfasına basılır ve gerçek etiket 90° yan + sayfanın üst kısmında durur,
 * gerisi boş kalır. Termal yazıcıda yarısı boş, yan çıkar. Bu modül o tip
 * etiketleri tespit edip dik 4×6'ya kırpar/döndürür.
 *
 * Strateji (C):
 *   - Zaten ~4×6 gelen etiket  → DOKUNULMAZ (UPS/USPS düzgün gelir).
 *   - Letter + tek baskın etiket görseli (2:3 oranlı) → dik 4×6'ya çevrilir.
 *   - Tanınmayan/farklı format → DOKUNULMAZ + uyarı döner (operatör elle bakar).
 *
 * Matematik: görselin yerleşim matrisi M içerik akışından çıkarılır; hedef
 * 4×6 için S = [288,0,0,432,0,0]; gömülü sayfa T = M⁻¹·S ile çizilir →
 * görsel dik 4×6'yı doldurur, sayfanın boş/beyaz kısmı sayfa dışına taşıp
 * kırpılır.
 */

import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFArray,
  PDFRef,
  decodePDFRawStream,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  drawObject,
} from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';

// Hedef etiket ebadı (4×6 inch, termal yazıcı standardı)
const TARGET_W = 288;
const TARGET_H = 432;

// "Zaten etiket boyutunda" sayılan üst sınır (≈4.4×6.5 inch zarfı).
// Daha büyük sayfa (Letter 612×792 gibi) → normalize denenir.
const LABEL_MAX_SHORT = 320; // ~4.4 in
const LABEL_MAX_LONG = 470; // ~6.5 in

// Normalize edilecek görselin geçerli kabul edileceği oran (2:3 = 1.5) toleransı
const ASPECT_TARGET = TARGET_H / TARGET_W; // 1.5
const ASPECT_TOL = 0.18;
const MIN_LABEL_DIM = 300; // görselin yerleşik kenarı en az ~4.2 in olmalı (logo değil)

export type LabelKind = 'ok' | 'fixed' | 'unknown';

export interface LabelAnalysis {
  kind: LabelKind;
  pageCount: number;
  /** kind !== 'ok' ise operatöre gösterilecek açıklama */
  message?: string;
}

// ---- affine matris yardımcıları ([a,b,c,d,e,f], satır-vektör konvansiyonu) ----
type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];

/** m1 önce, sonra m2 uygulanır (p × m1 × m2). */
const mul = (m1: Mat, m2: Mat): Mat => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];

const inv = (m: Mat): Mat => {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  const ia = d / det,
    ib = -b / det,
    ic = -c / det,
    id = a / det;
  return [ia, ib, ic, id, -(e * ia + f * ic), -(e * ib + f * id)];
};

interface FoundImage {
  ctm: Mat;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeContent(doc: PDFDocument, contentsObj: any): string {
  const parts: Buffer[] = [];
  const collect = (obj: unknown) => {
    let o = obj;
    if (o instanceof PDFRef) o = doc.context.lookup(o);
    if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) collect(o.get(i));
      return;
    }
    if (o instanceof PDFRawStream) parts.push(Buffer.from(decodePDFRawStream(o).decode()));
  };
  collect(contentsObj);
  return parts.map((p) => p.toString('latin1')).join('\n');
}

const NUM_RE = /^-?\d*\.?\d+$/;
const TOKEN_RE = /(<<|>>|\[|\]|\/[^\s/[\]<>()]+|-?\d*\.?\d+|[A-Za-z'"*]+[A-Za-z0-9'"*]*|\(|\)|<|>)/g;

function tokenize(s: string): string[] {
  const toks: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s))) toks.push(m[0]);
  return toks;
}

/**
 * İçerik akışını tarar, çizilen image XObject'lerin CTM'ini toplar.
 * Form XObject'lere bir kademe iner (FedEx etiketi çoğu zaman form içinde gömülü).
 */
function findImages(
  doc: PDFDocument,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resources: any,
  content: string,
  ctm: Mat,
  out: FoundImage[],
  depth: number
): void {
  if (depth > 3 || !resources?.lookup) return;
  const xobjDict = resources.lookup(PDFName.of('XObject'));
  if (!xobjDict?.lookup) return;

  const toks = tokenize(content);
  const stack: Mat[] = [];
  let cur: Mat = ctm.slice() as Mat;
  const nums: number[] = [];
  let names: string[] = [];

  for (const t of toks) {
    if (NUM_RE.test(t)) {
      nums.push(parseFloat(t));
      continue;
    }
    if (t.startsWith('/')) {
      names.push(t.slice(1));
      continue;
    }
    switch (t) {
      case 'q':
        stack.push(cur.slice() as Mat);
        break;
      case 'Q':
        cur = (stack.pop() as Mat) ?? (IDENT.slice() as Mat);
        break;
      case 'cm':
        if (nums.length >= 6) cur = mul(nums.slice(-6) as Mat, cur);
        break;
      case 'Do': {
        const name = names[names.length - 1];
        const xref = name ? xobjDict.get(PDFName.of(name)) : null;
        const xobj = xref ? doc.context.lookup(xref) : null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dict: any = xobj && (xobj as any).dict ? (xobj as any).dict : xobj;
        const sub = dict?.lookup ? dict.lookup(PDFName.of('Subtype')) : null;
        const subName = sub ? String(sub.encodedName ?? sub) : '';
        if (subName.includes('Image')) {
          out.push({ ctm: cur.slice() as Mat });
        } else if (subName.includes('Form') && xobj instanceof PDFRawStream) {
          const fm = dict.lookup(PDFName.of('Matrix'));
          let fmat: Mat = IDENT.slice() as Mat;
          if (fm?.size && fm.size() === 6) {
            fmat = [0, 1, 2, 3, 4, 5].map((i) => fm.get(i).asNumber()) as Mat;
          }
          const fres = dict.lookup(PDFName.of('Resources'));
          const fcontent = Buffer.from(decodePDFRawStream(xobj).decode()).toString('latin1');
          findImages(doc, fres, fcontent, mul(fmat, cur), out, depth + 1);
        }
        break;
      }
    }
    nums.length = 0;
    names = [];
  }
}

interface PagePlan {
  kind: LabelKind;
  /** kind === 'fixed' ise uygulanacak dönüşüm matrisi */
  transform?: Mat;
}

function isLabelSized(w: number, h: number): boolean {
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  return short <= LABEL_MAX_SHORT && long <= LABEL_MAX_LONG;
}

/** Tek sayfayı sınıflandırır: zaten ok mu, düzeltilebilir mi, yoksa bilinmeyen mi. */
function inspectPage(doc: PDFDocument, page: PDFPage): PagePlan {
  const { width, height } = page.getSize();

  // Zaten etiket boyutunda → dokunma.
  if (isLabelSized(width, height)) return { kind: 'ok' };

  // Büyük sayfa (Letter vb.) → tek baskın görsel ara.
  const images: FoundImage[] = [];
  try {
    const resources = page.node.Resources();
    const content = decodeContent(doc, page.node.Contents());
    findImages(doc, resources, content, IDENT.slice() as Mat, images, 0);
  } catch {
    return { kind: 'unknown' };
  }

  if (images.length === 0) return { kind: 'unknown' };

  // En büyük yerleşik alana sahip görseli seç.
  const sized = images.map((im) => {
    const uExt = Math.hypot(im.ctm[0], im.ctm[1]);
    const vExt = Math.hypot(im.ctm[2], im.ctm[3]);
    return { im, uExt, vExt, area: uExt * vExt, maxDim: Math.max(uExt, vExt) };
  });
  sized.sort((a, b) => b.area - a.area);
  const top = sized[0];

  // Etiket görseli yeterince büyük ve 2:3 oranında mı?
  const aspect = top.maxDim / Math.min(top.uExt, top.vExt);
  if (top.maxDim < MIN_LABEL_DIM || Math.abs(aspect - ASPECT_TARGET) > ASPECT_TOL) {
    return { kind: 'unknown' };
  }

  const T = mul(inv(top.im.ctm), [TARGET_W, 0, 0, TARGET_H, 0, 0]);
  return { kind: 'fixed', transform: T };
}

function combineKind(kinds: LabelKind[]): LabelKind {
  if (kinds.some((k) => k === 'unknown')) return 'unknown';
  if (kinds.some((k) => k === 'fixed')) return 'fixed';
  return 'ok';
}

function messageFor(kind: LabelKind): string | undefined {
  if (kind === 'unknown') {
    return 'Etiket standart 4×6 değil ve otomatik düzeltilemedi — yan/boş çıkabilir, elle kontrol edin.';
  }
  if (kind === 'fixed') {
    return 'Etiket 4×6 dışı geldi, otomatik olarak dik 4×6 formatına çevrildi.';
  }
  return undefined;
}

/**
 * PDF'i inceler ama DEĞİŞTİRMEZ — yükleme anında uyarı göstermek için.
 */
export async function analyzeLabelPdf(bytes: Uint8Array | Buffer): Promise<LabelAnalysis> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return { kind: 'unknown', pageCount: 0, message: 'PDF okunamadı (bozuk olabilir).' };
  }
  const pages = doc.getPages();
  const kinds = pages.map((p) => inspectPage(doc, p).kind);
  const kind = combineKind(kinds);
  return { kind, pageCount: pages.length, message: messageFor(kind) };
}

/**
 * PDF'i normalize eder. Düzeltilebilen sayfalar dik 4×6'ya çevrilir; zaten
 * düzgün veya tanınmayan sayfalar aynen korunur.
 *
 * Tüm sayfalar 'ok' ise orijinal byte'lar aynen döner (sıfır risk).
 */
export async function normalizeLabelPdf(
  bytes: Uint8Array | Buffer
): Promise<{ bytes: Uint8Array; analysis: LabelAnalysis }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return {
      bytes: new Uint8Array(bytes),
      analysis: { kind: 'unknown', pageCount: 0, message: 'PDF okunamadı (bozuk olabilir).' },
    };
  }

  const pages = doc.getPages();
  const plans = pages.map((p) => inspectPage(doc, p));
  const kind = combineKind(plans.map((p) => p.kind));
  const analysis: LabelAnalysis = { kind, pageCount: pages.length, message: messageFor(kind) };

  // Düzeltilecek bir şey yoksa orijinali aynen döndür.
  if (!plans.some((p) => p.kind === 'fixed')) {
    return { bytes: new Uint8Array(bytes), analysis };
  }

  const out = await PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    const plan = plans[i];
    if (plan.kind === 'fixed' && plan.transform) {
      const T = plan.transform;
      const np = out.addPage([TARGET_W, TARGET_H]);
      const embedded = await out.embedPage(pages[i]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const name = (np.node as any).newXObject('Lbl', embedded.ref);
      np.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(T[0], T[1], T[2], T[3], T[4], T[5]),
        drawObject(name),
        popGraphicsState()
      );
    } else {
      // 'ok' veya 'unknown' → sayfayı olduğu gibi kopyala.
      const [copied] = await out.copyPages(doc, [i]);
      out.addPage(copied);
    }
  }

  return { bytes: await out.save(), analysis };
}
