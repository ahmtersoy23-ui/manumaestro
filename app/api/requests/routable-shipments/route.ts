/**
 * Routable Shipments API
 * GET: Find available shipments for a marketplace's destination
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentView } from '@/lib/auth/requireShipmentRole';
import { errorResponse } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
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
      return NextResponse.json({
        success: true,
        data: { shipments: [], destinationTab: null },
      });
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

    return NextResponse.json({
      success: true,
      data: { shipments, destinationTab: route.destinationTab },
    });
  } catch (error) {
    return errorResponse(error, 'Uygun sevkiyatlar getirilemedi');
  }
}
