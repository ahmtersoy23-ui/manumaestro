/**
 * Routable Shipments API
 * GET: Find available shipments for a marketplace's destination
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentView } from '@/lib/auth/requireShipmentRole';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

// requireShipmentView destinasyon-bazlı özel yetki — handler içinde tutuluyor.
export const GET = withRoute(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Uygun sevkiyatlar getirilemedi' },
  async ({ request }) => {
    const authResult = await requireShipmentView(request);
    if (authResult instanceof NextResponse) return authResult;

    const marketplaceId = request.nextUrl.searchParams.get('marketplaceId');
    if (!marketplaceId) {
      return NextResponse.json(
        { success: false, error: 'marketplaceId parametresi gerekli' },
        { status: 400 }
      );
    }

    // Marketplace'in shipping route'unu bul
    const route = await prisma.shippingRoute.findUnique({
      where: { marketplaceId },
    });

    if (!route) {
      return successResponse({ shipments: [], destinationTab: null });
    }

    // O destinasyondaki aktif sevkiyatları getir (PLANNING veya LOADING)
    const shipments = await prisma.shipment.findMany({
      where: {
        destinationTab: route.destinationTab,
        status: { in: ['PLANNING', 'LOADING'] },
      },
      select: {
        id: true,
        name: true,
        status: true,
        plannedDate: true,
        shippingMethod: true,
      },
      orderBy: { plannedDate: 'asc' },
    });

    return successResponse({ shipments, destinationTab: route.destinationTab });
  }
);
