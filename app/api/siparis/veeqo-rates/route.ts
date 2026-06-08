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
import { getVeeqoRates, getVeeqoRatesStandalone, type VeeqoParcelInput, type VeeqoShipTo } from '@/lib/veeqo/databridgeClient';
import { getProductsByIwasku, usDimensions } from '@/lib/products/lookup';
import { getShippingBenchmark } from '@/lib/veeqo/benchmark';
import { getOrderShipTo } from '@/lib/veeqo/orderAddress';
import { getAmazonOrderDates } from '@/lib/wisersell/databridgeClient';
import { createLogger } from '@/lib/logger';

const logger = createLogger('VeeqoRates');

const AMAZON_CODES = ['AMZN_US', 'Ama_US'];
// Veeqo ship-from US (Somerset/Fairfield) → yalnız bu depolardan Veeqo etiketi
const US_WAREHOUSES = ['NJ', 'SHOWROOM'];
// İçerik-kısıtlı USPS servisleri — metal/genel ürün için GEÇERSİZ (BPM/Media/Library
// sadece basılı/medya içeriğe). Listede gösterme (yanlış servis = etiket reddi/sürşarj).
const RESTRICTED_SERVICE = /bound printed matter|media mail|library mail/i;
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
  // Yalnız TANIMLI ölçüleri koy — `undefined` anahtar spread'de DEFAULT_PARCEL'i ezerdi
  // (desi var ama ölçü yok = Alsat/Etsy → 4 boyut da undefined → DataBridge parcelSchema
  // reddi "Validation failed"). Eksik boyut DEFAULT_PARCEL'den dolar.
  const parcel: Partial<VeeqoParcelInput> = {};
  if (sumWt > 0) parcel.weight = Math.round(sumWt * 10) / 10;
  if (maxL > 0) parcel.length = maxL;
  if (maxW > 0) parcel.width = maxW;
  if (sumH > 0) parcel.height = Math.round(sumH * 10) / 10;
  return { parcel, desi: Math.round(sumDesi * 10) / 10 };
}

const Schema = z.object({
  orderId: z.string().uuid(),
  parcel: z.object({
    weight: z.number().positive(),
    length: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).partial().optional(),
  /** Amazon-dışı: operatörün modalda düzenlediği alıcı adresi (yoksa candidate'tan parse). */
  toAddress: z.object({
    name: z.string().min(1),
    line1: z.string().min(1),
    line2: z.string().optional(),
    town: z.string().min(1),
    county: z.string().optional(),
    postcode: z.string().min(1),
    country_code: z.string().min(2).max(2).optional(),
    phone: z.string().optional(),
  }).optional(),
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
  const { orderId, parcel, toAddress: editedAddress } = parsed.data;

  const order = await prisma.outboundOrder.findUnique({
    where: { id: orderId },
    include: { items: { select: { iwasku: true, quantity: true } } },
  });
  if (!order) {
    return NextResponse.json({ success: false, error: 'Sipariş bulunamadı' }, { status: 404 });
  }

  const isAmazon = AMAZON_CODES.includes(order.marketplaceCode);
  // Veeqo ship-from US (Somerset/Fairfield) — sadece US depolardan etiket alınır
  if (!US_WAREHOUSES.includes(order.warehouseCode)) {
    return NextResponse.json({ success: false, error: 'Veeqo etiket yalnız Somerset/Fairfield (US) deposundan alınabilir' }, { status: 400 });
  }

  // Amazon-dışı: alıcı adresi BİZDEN — operatör düzenlediyse onu, yoksa candidate'tan parse.
  let shipTo: (VeeqoShipTo & { parsed?: boolean }) | null = null;
  if (!isAmazon) {
    if (editedAddress) {
      shipTo = { ...editedAddress, country_code: editedAddress.country_code || 'US', parsed: true };
    } else {
      const parsedAddr = await getOrderShipTo(order.orderNumber);
      if (parsedAddr) {
        shipTo = {
          name: parsedAddr.name, line1: parsedAddr.line1, town: parsedAddr.town,
          county: parsedAddr.county, postcode: parsedAddr.postcode,
          country_code: parsedAddr.country_code, phone: parsedAddr.phone, parsed: parsedAddr.parsed,
        };
      }
    }
    if (!shipTo) {
      return NextResponse.json({ success: false, error: 'Alıcı adresi bulunamadı — modaldan elle girin', needsAddress: true }, { status: 422 });
    }
  }

  // Koli ölçüsü: önce katalog (products), üstüne operatörün modalda düzenlediği değerler.
  const catalog = await deriveParcelFromCatalog(order.items);
  const finalParcel: VeeqoParcelInput = { ...DEFAULT_PARCEL, ...(catalog?.parcel ?? {}), ...(parcel ?? {}) };

  try {
    const result = isAmazon
      ? await getVeeqoRates(order.orderNumber, finalParcel, { contents: order.description || undefined, warehouse: order.warehouseCode })
      : await getVeeqoRatesStandalone(shipTo as VeeqoShipTo, finalParcel, { contents: order.description || undefined, warehouse: order.warehouseCode, reference: order.orderNumber });
    // İçerik-kısıtlı servisleri (BPM/Media/Library Mail) listeden çıkar
    const quotes = (result.quotes ?? []).filter((q) => !RESTRICTED_SERVICE.test(q.service_name));
    const benchmark = await getShippingBenchmark({ desi: catalog?.desi ?? null, weightLb: finalParcel.weight ?? null, state: result.destState ?? null });
    // Amazon SLA (LatestShip/LatestDelivery) — operatör quote teslim süreleriyle kıyaslasın.
    // Sadece Amazon US; best-effort (SP-API patlarsa rates bozulmasın). Non-Amazon'da yok.
    const deliverInfo = isAmazon ? await getAmazonOrderDates(order.orderNumber).catch(() => null) : null;
    logger.info(`rates OK (${isAmazon ? 'amazon' : 'standalone'}): ${order.orderNumber} → ${quotes.length} quote`);
    // modal için: parcel + katalog kaynağı + kıyas + (standalone'da) kullanılan adres + parse güveni + teslim bilgisi
    return NextResponse.json({
      success: true, ...result, quotes, parcel: finalParcel, parcelFromCatalog: !!catalog, benchmark,
      ...(shipTo ? { shipTo, addressParsed: shipTo.parsed !== false } : {}),
      ...(deliverInfo ? { deliverInfo } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Veeqo oran hatası';
    logger.error(`rates error: ${order.orderNumber}: ${msg}`);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
