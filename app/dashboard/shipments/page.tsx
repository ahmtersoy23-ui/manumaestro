/**
 * Shipments Dashboard — Server Component.
 *
 * URL searchParams ile destinasyon seçimi (?tab=US_FBA|NJ_DEPO|CG_DEPO|...).
 * Yeni yapı: 2-seviyeli tab (üst ülke + alt destinasyon). ShipmentsClient
 * tab değişimini router.replace(?tab=...) ile tetikler, fresh RSC.
 */

import { prisma } from '@/lib/db/prisma';
import { getShipmentRole, canDoAction } from '@/lib/auth/shipmentPermission';
import { getRscUser } from '@/lib/auth/rscUser';
import { SHIPMENT_DESTINATIONS_BY_COUNTRY, SHIPMENT_COUNTRIES } from '@/lib/marketplaceRegions';
import { ShipmentsClient, type ShipmentDTO } from './ShipmentsClient';

const ALL_DESTINATIONS = SHIPMENT_COUNTRIES.flatMap(c => SHIPMENT_DESTINATIONS_BY_COUNTRY[c]);

function parseDestination(raw: string | undefined): string {
  if (raw && ALL_DESTINATIONS.includes(raw)) return raw;
  return 'US_FBA'; // default
}

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ShipmentsPage({ searchParams }: PageProps) {
  const { tab: tabParam } = await searchParams;
  const activeDestination = parseDestination(tabParam);

  const user = await getRscUser();

  const shipments = await prisma.shipment.findMany({
    where: { destinationTab: activeDestination },
    include: {
      items: {
        select: { iwasku: true, quantity: true, desi: true, marketplaceId: true },
      },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const initialShipments: ShipmentDTO[] = shipments.map(s => {
    const totalQty = s.items.reduce((sum, i) => sum + i.quantity, 0);
    const totalDesi = s.items.reduce((sum, i) => sum + (i.desi ?? 0) * i.quantity, 0);
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
    };
  });

  const userShipRole = user
    ? await getShipmentRole(user.id, user.role, activeDestination)
    : null;
  const canCreate = canDoAction(userShipRole, 'createShipment');

  return (
    <ShipmentsClient
      activeDestination={activeDestination}
      initialShipments={initialShipments}
      canCreate={canCreate}
    />
  );
}
