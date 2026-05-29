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

    // Bu ülkedeki sevkiyatların item iwasku'ları (zaten ekli olanlar)
    const takenItems = await prisma.shipmentItem.findMany({
      where: {
        shipment: { destinationTab: country },
      },
      select: { iwasku: true },
    });
    const takenIwaskus = new Set(takenItems.map(it => it.iwasku));

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

    const pending = prs
      .filter(p => !takenIwaskus.has(p.iwasku))
      .map(p => ({
        id: p.id,
        iwasku: p.iwasku,
        productName: p.productName,
        productCategory: p.productCategory,
        productSize: p.productSize,
        quantity: p.quantity,
        producedQuantity: p.producedQuantity,
        marketplaceCode: p.marketplace.code,
        marketplaceName: p.marketplace.name,
        recommendedDestination: p.recommendedDestination,
        productionMonth: p.productionMonth,
      }));

    return successResponse({ country, destination: destFilter, items: pending });
  },
);
