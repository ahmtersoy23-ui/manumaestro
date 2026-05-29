/**
 * Shipments Dashboard — Server Component.
 *
 * URL searchParams ile ülke tab seçimi (?tab=US|UK|EU|CA|AU|ZA).
 * Sevkiyat artık ülke-bazlı konteyner; içindeki item'lar farklı destinasyona
 * gidebilir (US gemisi içinde US FBA + NJ Depo + CG Depo karma).
 *
 * "Bekleyen Havuzlar" kartı için /api/shipments/pools?country=... ayrıca client'tan
 * fetch ediliyor (real-time özet).
 */

import { prisma } from '@/lib/db/prisma';
import { getShipmentRole, canDoAction } from '@/lib/auth/shipmentPermission';
import { getRscUser } from '@/lib/auth/rscUser';
import { SHIPMENT_COUNTRIES, type ShipmentCountry } from '@/lib/marketplaceRegions';
import { ShipmentsClient, type ShipmentDTO } from './ShipmentsClient';

function parseCountry(raw: string | undefined): ShipmentCountry {
  if (raw && (SHIPMENT_COUNTRIES as readonly string[]).includes(raw)) return raw as ShipmentCountry;
  // Geriye uyumluluk: eski destinasyon koduyla geldi ise ülkeye map
  if (raw === 'US_FBA' || raw === 'NJ_DEPO' || raw === 'CG_DEPO') return 'US';
  if (raw === 'UK_FBA' || raw === 'UK_DEPO') return 'UK';
  if (raw === 'EU_FBA' || raw === 'NL_DEPO') return 'EU';
  if (raw === 'CA_FBA') return 'CA';
  if (raw === 'AU_FBA') return 'AU';
  if (raw === 'ZA_TAKEALOT') return 'ZA';
  return 'US';
}

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ShipmentsPage({ searchParams }: PageProps) {
  const { tab: tabParam } = await searchParams;
  const activeCountry = parseCountry(tabParam);

  const user = await getRscUser();

  const shipments = await prisma.shipment.findMany({
    where: { destinationTab: activeCountry },
    include: {
      items: {
        select: { iwasku: true, quantity: true, desi: true, marketplaceId: true, recommendedDestination: true },
      },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const initialShipments: ShipmentDTO[] = shipments.map(s => {
    const totalQty = s.items.reduce((sum, i) => sum + i.quantity, 0);
    const totalDesi = s.items.reduce((sum, i) => sum + (i.desi ?? 0) * i.quantity, 0);
    // Destinasyon dağılımı (item-level recommendedDestination'a göre)
    const destBreakdown: Record<string, number> = {};
    for (const item of s.items) {
      const d = item.recommendedDestination ?? 'UNKNOWN';
      destBreakdown[d] = (destBreakdown[d] ?? 0) + item.quantity;
    }
    return {
      id: s.id,
      name: s.name,
      destinationTab: s.destinationTab,
      shippingMethod: s.shippingMethod,
      plannedDate: s.plannedDate ? s.plannedDate.toISOString() : '',
      actualDate: s.actualDate ? s.actualDate.toISOString() : null,
      status: s.status,
      notes: s.notes,
      stats: {
        itemCount: s._count.items,
        totalQty,
        totalDesi: Math.round(totalDesi),
      },
      destBreakdown,
    };
  });

  const userShipRole = user
    ? await getShipmentRole(user.id, user.role, activeCountry)
    : null;
  const canCreate = canDoAction(userShipRole, 'createShipment');

  return (
    <ShipmentsClient
      activeCountry={activeCountry}
      initialShipments={initialShipments}
      canCreate={canCreate}
    />
  );
}
