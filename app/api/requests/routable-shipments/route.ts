/**
 * Routable Shipments API
 * GET: Find available shipments for a marketplace's destination
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyAuth } from '@/lib/auth/verify';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

// Talep eden kullanicilar kendi pazaryerleri icin yonlendirme yapabilsin diye
// destinasyon-bazli yetki yerine sade auth yeterli. Sonuc zaten marketplaceId'nin
// destinationTab'i ile filtreleniyor ve sadece okuma — gerçek yönlendirme aksiyonu
// route-to-shipment'ta self-route bypass'la korunur.
export const GET = withRoute(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Uygun sevkiyatlar getirilemedi' },
  async ({ request }) => {
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Yetkisiz erisim' },
        { status: 401 }
      );
    }

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
