/**
 * GET /api/shipment-boxes/by-number?n=71-1011
 * Bir sevkiyat kolisi'nin içeriğini boxNumber ile döndürür.
 * Mobil "Koli Ekle" akışında QR'dan okunan boxNumber → otomatik form doldurma.
 *
 * 404: kayıt yok (büyük olasılıkla eski/sevkiyat-dışı koli, manuel giriş gerekli)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Koli sorgusu başarısız' },
  async ({ request }) => {
    const boxNumber = request.nextUrl.searchParams.get('n')?.trim() ?? '';
    if (!boxNumber) {
      return NextResponse.json(
        { success: false, error: 'Koli numarası gerekli' },
        { status: 400 },
      );
    }

    const box = await prisma.shipmentBox.findFirst({
      where: { boxNumber },
      include: {
        shipment: {
          select: { id: true, name: true, destinationTab: true, status: true },
        },
      },
    });

    if (!box) {
      return NextResponse.json(
        { success: false, error: `Koli bulunamadı: ${boxNumber}` },
        { status: 404 },
      );
    }

    return successResponse({
      boxNumber: box.boxNumber,
      iwasku: box.iwasku,
      fnsku: box.fnsku,
      productName: box.productName,
      productCategory: box.productCategory,
      quantity: box.quantity,
      destination: box.destination,
      marketplaceCode: box.marketplaceCode,
      width: box.width,
      depth: box.depth,
      height: box.height,
      weight: box.weight,
      shipment: box.shipment,
    });
  },
);
