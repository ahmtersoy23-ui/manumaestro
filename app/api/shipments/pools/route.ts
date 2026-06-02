/**
 * GET /api/shipments/pools?country=US
 *
 * Bir ülkenin destinasyon havuzlarındaki "sevkiyat bekleyen" ürün özeti.
 * Havuz kuralı: production_requests.status='COMPLETED' AND iwasku henüz
 * shipment_items'ta yok (bu ülkenin sevkiyatlarında).
 *
 * Karma sevkiyat akışı için: operatör US gemisi oluşturur, "Bekleyen Havuzlar"
 * kartında US FBA / NJ Depo / CG Depo sayılarını görür, havuzdan item alır.
 */

import { prisma } from '@/lib/db/prisma';
import { successResponse } from '@/lib/api/response';
import { withRoute } from '@/lib/api/withRoute';
import {
  SHIPMENT_DESTINATIONS_BY_COUNTRY,
  SHIPMENT_DESTINATION_LABELS,
  type ShipmentCountry,
} from '@/lib/marketplaceRegions';

const VALID_COUNTRIES: ShipmentCountry[] = ['US', 'UK', 'EU', 'CA', 'AU', 'ZA'];

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Havuz verisi getirilemedi' },
  async ({ request }) => {
    const country = request.nextUrl.searchParams.get('country') as ShipmentCountry | null;
    if (!country || !VALID_COUNTRIES.includes(country)) {
      return successResponse({ pools: [] });
    }

    const destinations = SHIPMENT_DESTINATIONS_BY_COUNTRY[country];
    if (destinations.length === 0) return successResponse({ pools: [] });

    // 1. Bu ülkenin sevkiyatlarındaki iwasku'ları topla (zaten ekli olanlar).
    //    Her ay yeni sistem: yalnız hazırlanmakta olan (PLANNING/LOADING)
    //    sevkiyatlar "alınmış" sayılır; yola çıkmış/teslim eski gönderiler değil.
    const takenItems = await prisma.shipmentItem.findMany({
      where: {
        shipment: { destinationTab: country, status: { in: ['PLANNING', 'LOADING'] } },
      },
      select: { iwasku: true, recommendedDestination: true },
    });
    const takenByDest = new Map<string, Set<string>>();
    for (const it of takenItems) {
      const dest = it.recommendedDestination ?? 'UNKNOWN';
      if (!takenByDest.has(dest)) takenByDest.set(dest, new Set());
      takenByDest.get(dest)!.add(it.iwasku);
    }

    // 2. COMPLETED PR'lar destinasyon bazlı toplu özet
    const completedPRs = await prisma.productionRequest.groupBy({
      by: ['recommendedDestination'],
      where: {
        status: 'COMPLETED',
        recommendedDestination: { in: destinations },
      },
      _count: { id: true },
      _sum: { quantity: true },
    });

    // 3. Her destinasyon için: PR sayısı, miktar, "bekleyen" hesabı
    //    (PR.quantity - ShipmentItem'da kayıtlı = bekleyen)
    //    NOT: tam doğru hesap için iwasku bazlı PR×Item joinlemesi gerek;
    //    bu özet sayfası için yaklaşık (PR sayısı + sevkiyata atanmamış iwasku sayısı) yeterli.
    const allCompletedPRs = await prisma.productionRequest.findMany({
      where: {
        status: 'COMPLETED',
        recommendedDestination: { in: destinations },
      },
      select: { iwasku: true, recommendedDestination: true, quantity: true },
    });

    const pools = destinations.map(dest => {
      const taken = takenByDest.get(dest) ?? new Set();
      const prsForDest = allCompletedPRs.filter(p => p.recommendedDestination === dest);
      const pending = prsForDest.filter(p => !taken.has(p.iwasku));
      const stats = completedPRs.find(g => g.recommendedDestination === dest);
      return {
        destination: dest,
        label: SHIPMENT_DESTINATION_LABELS[dest] ?? dest,
        totalCompletedPRs: stats?._count.id ?? 0,
        totalCompletedQty: stats?._sum.quantity ?? 0,
        // Modal (iwasku+dest bazlı birleştirilmiş) ile tutarlı: PR adedi değil,
        // bekleyen DISTINCT iwasku sayısı.
        pendingPRs: new Set(pending.map(p => p.iwasku)).size,
        pendingQty: pending.reduce((s, p) => s + p.quantity, 0),
      };
    });

    return successResponse({ country, pools });
  },
);
