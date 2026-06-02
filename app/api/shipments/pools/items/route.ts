/**
 * GET /api/shipments/pools/items?country=US[&destination=NJ_DEPO]
 *
 * Bir ülkenin (opsiyonel destinasyon filtreli) sevkiyat bekleyen PR detay
 * listesi. Operatör sevkiyat detay sayfasında "Havuzdan Ekle" modal'ında
 * bu listeden checkbox ile seçim yapar.
 *
 * Havuz kuralı: production_requests.status='COMPLETED' AND iwasku henüz
 * bu ülkenin shipment_items'larında yok (yani sevkiyata atanmamış).
 */

import { prisma } from '@/lib/db/prisma';
import { successResponse } from '@/lib/api/response';
import { withRoute } from '@/lib/api/withRoute';
import {
  SHIPMENT_DESTINATIONS_BY_COUNTRY,
  type ShipmentCountry,
} from '@/lib/marketplaceRegions';

const VALID_COUNTRIES: ShipmentCountry[] = ['US', 'UK', 'EU', 'CA', 'AU', 'ZA'];

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Havuz detayı getirilemedi' },
  async ({ request }) => {
    const country = request.nextUrl.searchParams.get('country') as ShipmentCountry | null;
    const destFilter = request.nextUrl.searchParams.get('destination');
    if (!country || !VALID_COUNTRIES.includes(country)) {
      return successResponse({ items: [] });
    }

    const destinations = SHIPMENT_DESTINATIONS_BY_COUNTRY[country];
    const targetDestinations = destFilter && destinations.includes(destFilter) ? [destFilter] : destinations;

    // Bu ülkedeki sevkiyatların item iwasku'ları (zaten ekli olanlar).
    // Her ay yeni sistem: yalnız hazırlanmakta olan (henüz yola çıkmamış)
    // sevkiyatlar "alınmış" sayılır; IN_TRANSIT/DELIVERED eski gönderiler
    // havuzu bloklamaz.
    const takenItems = await prisma.shipmentItem.findMany({
      where: {
        shipment: { destinationTab: country, status: { in: ['PLANNING', 'LOADING'] } },
      },
      select: { iwasku: true, recommendedDestination: true },
    });
    // Destinasyon-bazlı "alınmış": aynı iwasku farklı destinasyonlarda (örn.
    // Amazon US_FBA + Wayfair CG_DEPO) bağımsızdır; biri eklenince diğeri
    // havuzdan düşmez (karma sevkiyat).
    const takenByDest = new Map<string, Set<string>>();
    for (const it of takenItems) {
      const dest = it.recommendedDestination ?? 'UNKNOWN';
      if (!takenByDest.has(dest)) takenByDest.set(dest, new Set());
      takenByDest.get(dest)!.add(it.iwasku);
    }

    // COMPLETED PR'lar
    const prs = await prisma.productionRequest.findMany({
      where: {
        status: 'COMPLETED',
        recommendedDestination: { in: targetDestinations },
      },
      include: {
        marketplace: { select: { code: true, name: true } },
      },
      orderBy: [{ recommendedDestination: 'asc' }, { iwasku: 'asc' }],
    });

    // (iwasku, destinasyon) bazında BİRLEŞTİR: aynı ürün+destinasyon için tüm
    // pazaryeri PR'larının miktarı toplanır → havuzda tek satır. Pazaryeri ayrımı
    // depoya vardıktan sonra (POOL raf) yapılır.
    const visible = prs.filter(
      p => !takenByDest.get(p.recommendedDestination ?? 'UNKNOWN')?.has(p.iwasku)
    );

    interface Agg {
      id: string;
      iwasku: string;
      productName: string;
      productCategory: string;
      productSize: number | null;
      recommendedDestination: string | null;
      quantity: number;
      marketplaces: { code: string; name: string; quantity: number }[];
    }
    const aggMap = new Map<string, Agg>();
    for (const p of visible) {
      const key = `${p.iwasku}|${p.recommendedDestination ?? ''}`;
      const mp = { code: p.marketplace.code, name: p.marketplace.name, quantity: p.quantity };
      const cur = aggMap.get(key);
      if (cur) {
        cur.quantity += p.quantity;
        cur.marketplaces.push(mp);
      } else {
        aggMap.set(key, {
          id: key,
          iwasku: p.iwasku,
          productName: p.productName,
          productCategory: p.productCategory,
          productSize: p.productSize,
          recommendedDestination: p.recommendedDestination,
          quantity: p.quantity,
          marketplaces: [mp],
        });
      }
    }

    return successResponse({ country, destination: destFilter, items: [...aggMap.values()] });
  },
);
