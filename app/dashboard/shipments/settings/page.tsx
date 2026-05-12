/**
 * Shipping Settings — Routing Table (Server Component).
 *
 * Marketplace → destination tab + shipping method + lead time eşleştirmesi.
 * Admin only. Server'da header'dan role kontrolü + Prisma'dan routes &
 * marketplaces. Tablo state + save action client component'te.
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import { Settings, AlertCircle, ArrowLeft } from 'lucide-react';
import { prisma } from '@/lib/db/prisma';
import { SettingsClient, type RouteDTO, type MarketplaceDTO } from './SettingsClient';

export default async function ShipmentSettingsPage() {
  const h = await headers();
  const userRole = h.get('x-user-role');

  if (userRole !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <AlertCircle className="w-12 h-12 text-red-400" />
      </div>
    );
  }

  const [routes, marketplaces] = await Promise.all([
    prisma.shippingRoute.findMany({
      include: { marketplace: { select: { id: true, name: true, code: true, region: true } } },
      orderBy: { destinationTab: 'asc' },
    }),
    prisma.marketplace.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const initialRoutes: RouteDTO[] = routes.map(r => ({
    id: r.id,
    marketplaceId: r.marketplaceId,
    destinationTab: r.destinationTab,
    shippingMethod: r.shippingMethod,
    leadTimeDays: r.leadTimeDays,
    marketplace: r.marketplace,
  }));

  const initialMarketplaces: MarketplaceDTO[] = marketplaces.map(m => ({
    id: m.id, name: m.name, code: m.code, region: m.region,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/shipments" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
          <Settings className="w-5 h-5 text-gray-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sevkiyat Routing</h1>
          <p className="text-sm text-gray-500">Pazaryeri → hat eşleştirmesi</p>
        </div>
      </div>

      <SettingsClient initialRoutes={initialRoutes} marketplaces={initialMarketplaces} />
    </div>
  );
}
