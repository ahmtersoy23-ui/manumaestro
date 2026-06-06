/**
 * POST /api/siparis/veeqo-rates  { orderId, parcel? }
 *
 * Veeqo'dan kargo oranlarını çeker (etiket ALMAZ). Operatör modalda en ucuzu
 * görüp seçer → /api/siparis/veeqo-label ile satın alır.
 *
 * Sadece Amazon (WISERSELL_AUTO, AMZN_US/Ama_US) — Veeqo'da yalnız Amazon kanalı bağlı.
 * Yetki: requireBoardManager (etiket = gerçek para, otomasyon-tier).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireBoardManager } from '@/lib/auth/boardAuth';
import { getVeeqoRates, type VeeqoParcelInput } from '@/lib/veeqo/databridgeClient';
import { getProductsByIwasku, usDimensions } from '@/lib/products/lookup';
import { getShippingBenchmark } from '@/lib/veeqo/benchmark';
import { createLogger } from '@/lib/logger';

const logger = createLogger('VeeqoRates');

const AMAZON_CODES = ['AMZN_US', 'Ama_US'];
// Katalog ölçüsü hiç yoksa son-çare varsayılan (operatör modalda düzenler).
const DEFAULT_PARCEL: VeeqoParcelInput = { weight: 2, weight_unit: 'lb', length: 12, width: 9, height: 3, dimension_unit: 'in' };

/**
 * Koliyi KENDİ kataloğumuzdan (products: cm+kg) türetir — Amazon verisine bakmaz.
 * Çok kalem: L/W = en büyük, H = Σ(yükseklik×adet) (üst üste), ağırlık = Σ(ağırlık×adet).
 * Eksik ölçü → o boyut atlanır (DEFAULT ile doldurulur).
 */
async function deriveParcelFromCatalog(items: Array<{ iwasku: string; quantity: number }>): Promise<{ parcel: Partial<VeeqoParcelInput>; desi: number } | null> {
  const products = await getProductsByIwasku(items.map((i) => i.iwasku));
  let maxL = 0, maxW = 0, sumH = 0, sumWt = 0, sumDesi = 0, any = false;
  for (const it of items) {
    const p = products.get(it.iwasku);
    const dim = usDimensions(p);
    const q = it.quantity || 1;
    if (p?.desi) sumDesi += p.desi * q;
    if (!dim) continue;
    any = true;
    if (dim.lengthIn) maxL = Math.max(maxL, dim.lengthIn);
    if (dim.widthIn) maxW = Math.max(maxW, dim.widthIn);
    if (dim.heightIn) sumH += dim.heightIn * q;
    if (dim.weightLb) sumWt += dim.weightLb * q;
  }
  if (!any && sumDesi === 0) return null;
  return {
    parcel: {
      weight: sumWt > 0 ? Math.round(sumWt * 10) / 10 : undefined,
      length: maxL > 0 ? maxL : undefined,
      width: maxW > 0 ? maxW : undefined,
      height: sumH > 0 ? Math.round(sumH * 10) / 10 : undefined,
    },
    desi: Math.round(sumDesi * 10) / 10,
  };
}

const Schema = z.object({
  orderId: z.string().uuid(),
  parcel: z.object({
    weight: z.number().positive(),
    length: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).partial().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireBoardManager(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { orderId, parcel } = parsed.data;

  const order = await prisma.outboundOrder.findUnique({
    where: { id: orderId },
    include: { items: { select: { iwasku: true, quantity: true } } },
  });
  if (!order) {
    return NextResponse.json({ success: false, error: 'Sipariş bulunamadı' }, { status: 404 });
  }
  if (!AMAZON_CODES.includes(order.marketplaceCode)) {
    return NextResponse.json({ success: false, error: 'Veeqo etiket şu an sadece Amazon siparişlerinde (Faz 2: diğer pazar yerleri)' }, { status: 400 });
  }

  // Koli ölçüsü: önce katalog (products), üstüne operatörün modalda düzenlediği değerler.
  const catalog = await deriveParcelFromCatalog(order.items);
  const finalParcel: VeeqoParcelInput = { ...DEFAULT_PARCEL, ...(catalog?.parcel ?? {}), ...(parcel ?? {}) };

  try {
    const [result, benchmark] = await Promise.all([
      getVeeqoRates(order.orderNumber, finalParcel, { contents: order.description || undefined, warehouse: order.warehouseCode }),
      getShippingBenchmark({ desi: catalog?.desi ?? null, weightLb: finalParcel.weight ?? null }),
    ]);
    logger.info(`rates OK: ${order.orderNumber} → ${result.quotes.length} quote (parcel ${finalParcel.weight}lb ${finalParcel.length}x${finalParcel.width}x${finalParcel.height})`);
    // modalın ölçü kutularını doldurması için kullanılan parcel'ı + katalog kaynağını + kıyas verisini döndür
    return NextResponse.json({ success: true, ...result, parcel: finalParcel, parcelFromCatalog: !!catalog, benchmark });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Veeqo oran hatası';
    logger.error(`rates error: ${order.orderNumber}: ${msg}`);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
