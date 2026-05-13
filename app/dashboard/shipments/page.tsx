/**
 * Shipments Dashboard — Server Component.
 *
 * URL searchParams ile tab seçimi (?tab=US|UK|EU|NL|AU|ZA). Prisma'dan
 * shipments + permission'ı server'da çeker, client component sadece
 * tab switching + create form için kalır.
 */

import { prisma } from '@/lib/db/prisma';
import { getShipmentRole, canDoAction } from '@/lib/auth/shipmentPermission';
import { getRscUser } from '@/lib/auth/rscUser';
import { ShipmentsClient, type ShipmentDTO, type Tab } from './ShipmentsClient';

const TABS = ['US', 'UK', 'EU', 'NL', 'AU', 'ZA'] as const;

function parseTab(raw: string | undefined): Tab {
  if (raw && (TABS as readonly string[]).includes(raw)) return raw as Tab;
  return 'US';
}

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ShipmentsPage({ searchParams }: PageProps) {
  const { tab: tabParam } = await searchParams;
  const activeTab = parseTab(tabParam);

  const user = await getRscUser();

  const shipments = await prisma.shipment.findMany({
    where: { destinationTab: activeTab },
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
    ? await getShipmentRole(user.id, user.role, activeTab)
    : null;
  const canCreate = canDoAction(userShipRole, 'createShipment');

  return (
    <ShipmentsClient
      activeTab={activeTab}
      initialShipments={initialShipments}
      canCreate={canCreate}
    />
  );
}
