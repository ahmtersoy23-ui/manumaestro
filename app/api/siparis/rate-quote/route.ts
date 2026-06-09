/**
 * POST /api/siparis/rate-quote  { warehouse, postcode, state, parcel, contents? }
 *
 * Siparişe bağlı OLMAYAN serbest kargo fiyat sorgusu (ad-hoc). Operatör yalnız varış
 * ZIP + eyalet + koli ölçüsü girer; isim/sokak/şehir GEREKMEZ (rate hesabı bunlara
 * bakmaz) → generic doldurulur. Etiket ALMAZ, para çekmez (getRates salt sorgu,
 * is_amazon_order:false).
 *
 * Not: Amazon Shipping rate validator'ı eyaleti ZORUNLU tutar ve ZIP ile uyumlu olmalı
 * (test 2026-06-08: eyaletsiz / yanlış eyalet → 400). Eyalet UI'da ZIP'ten türetilir.
 *
 * Yetki: APPROVER+ (board operatörü; süper-admin=FULL geçer).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrderBoardLevel } from '@/lib/auth/orderBoardPermission';
import { getVeeqoRatesStandalone, type VeeqoParcelInput } from '@/lib/veeqo/databridgeClient';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RateQuote');

// İçerik-kısıtlı USPS servisleri (BPM/Media/Library = sadece basılı/medya) — genel ürün için geçersiz, gizle.
const RESTRICTED_SERVICE = /bound printed matter|media mail|library mail/i;

const Schema = z.object({
  /** Veeqo ship-from US deposu: 'NJ' → Somerset, 'SHOWROOM' → Fairfield */
  warehouse: z.enum(['NJ', 'SHOWROOM']).default('NJ'),
  postcode: z.string().trim().min(3),
  /** 2 harf US eyalet — ZIP ile uyumlu olmalı (UI ZIP'ten türetir, elle düzeltilebilir). */
  state: z.string().trim().length(2),
  parcel: z.object({
    weight: z.number().positive(),
    weight_unit: z.enum(['lb', 'kg', 'oz', 'g']).default('lb'),
    length: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
    dimension_unit: z.enum(['in', 'cm']).default('in'),
  }),
  contents: z.string().max(120).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireOrderBoardLevel(request, 'APPROVER');
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Doğrulama hatası', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { warehouse, postcode, state, parcel, contents } = parsed.data;

  // İsim/sokak/şehir rate için gereksiz (test: generic değer 24 quote döndü) → generic doldur.
  // Eyalet gerçek olmalı (ZIP ile uyumlu); ZIP + eyalet fiyatı belirler.
  const toAddress = {
    name: 'Rate Quote', line1: '1 Main St', town: 'City',
    county: state.toUpperCase(), postcode, country_code: 'US',
  };

  try {
    const result = await getVeeqoRatesStandalone(
      toAddress,
      parcel as VeeqoParcelInput,
      { warehouse, contents: contents || 'Wall Art', reference: 'rate-quote' },
    );
    const quotes = (result.quotes ?? []).filter((q) => !RESTRICTED_SERVICE.test(q.service_name));
    logger.info(`rate-quote OK: ${warehouse}→${state} ${postcode} → ${quotes.length} quote`);
    return NextResponse.json({ success: true, quotes, destState: result.destState ?? state.toUpperCase() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Veeqo oran hatası';
    logger.error(`rate-quote error: ${msg}`);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
