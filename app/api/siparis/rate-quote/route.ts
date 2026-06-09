/**
 * POST /api/siparis/rate-quote  { warehouse, toAddress, parcel, contents? }
 *
 * Siparişe bağlı OLMAYAN serbest kargo fiyat sorgusu (ad-hoc): operatör ölçü + adres
 * girer, Veeqo'dan oran listesi döner. Etiket ALMAZ, para çekmez (getRates salt sorgu,
 * is_amazon_order:false). veeqo-rates'ten farkı: orderId gerekmez.
 *
 * Yetki: APPROVER+ (board operatörü; süper-admin=FULL zaten geçer). Salt-okur ama
 * harici Veeqo çağrısı → rastgele authed kullanıcıya açık olmasın.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrderBoardLevel } from '@/lib/auth/orderBoardPermission';
import { getVeeqoRatesStandalone, type VeeqoParcelInput, type VeeqoShipTo } from '@/lib/veeqo/databridgeClient';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RateQuote');

// İçerik-kısıtlı USPS servisleri (BPM/Media/Library = sadece basılı/medya) — genel ürün için geçersiz, gizle.
const RESTRICTED_SERVICE = /bound printed matter|media mail|library mail/i;

const Schema = z.object({
  /** Veeqo ship-from US deposu: 'NJ' → Somerset, 'SHOWROOM' → Fairfield */
  warehouse: z.enum(['NJ', 'SHOWROOM']).default('NJ'),
  toAddress: z.object({
    name: z.string().min(1),
    line1: z.string().min(1),
    line2: z.string().optional(),
    town: z.string().min(1),
    county: z.string().optional(),
    postcode: z.string().min(1),
    country_code: z.string().min(2).max(2).default('US'),
    phone: z.string().optional(),
  }),
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
  const { warehouse, toAddress, parcel, contents } = parsed.data;

  try {
    const result = await getVeeqoRatesStandalone(
      toAddress as VeeqoShipTo,
      parcel as VeeqoParcelInput,
      { warehouse, contents: contents || 'Wall Art', reference: 'rate-quote' },
    );
    const quotes = (result.quotes ?? []).filter((q) => !RESTRICTED_SERVICE.test(q.service_name));
    logger.info(`rate-quote OK: ${warehouse} → ${quotes.length} quote`);
    return NextResponse.json({ success: true, quotes, destState: result.destState ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Veeqo oran hatası';
    logger.error(`rate-quote error: ${msg}`);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
