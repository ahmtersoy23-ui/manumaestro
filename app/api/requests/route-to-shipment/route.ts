/**
 * Route to Shipment API
 * POST: Route completed production requests to a shipment
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { RouteToShipmentSchema, formatValidationError } from '@/lib/validation/schemas';
import { errorResponse } from '@/lib/api/response';
import { logAction } from '@/lib/auditLog';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = RouteToShipmentSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: formatValidationError(validation.error) },
        { status: 400 }
      );
    }

    const { requestIds, shipmentId } = validation.data;

    // Tüm request'leri getir
    const requests = await prisma.productionRequest.findMany({
      where: { id: { in: requestIds } },
      select: { id: true, iwasku: true, productName: true, productSize: true, quantity: true, status: true, marketplaceId: true },
    });

    if (requests.length !== requestIds.length) {
      return NextResponse.json(
        { success: false, error: `${requestIds.length - requests.length} talep bulunamadı` },
        { status: 404 }
      );
    }

    // Hepsi COMPLETED olmalı
    const nonCompleted = requests.filter(r => r.status !== 'COMPLETED');
    if (nonCompleted.length > 0) {
      return NextResponse.json(
        { success: false, error: `${nonCompleted.length} talep henüz tamamlanmamış. Sadece tamamlanan talepler yönlendirilebilir.` },
        { status: 400 }
      );
    }

    // Shipment kontrolü
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) {
      return NextResponse.json(
        { success: false, error: 'Sevkiyat bulunamadi' },
        { status: 404 }
      );
    }

    const authResult = await requireShipmentAction(request, shipment.destinationTab, 'routeItems');
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    if (shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED') {
      return NextResponse.json(
        { success: false, error: 'Gönderilmiş veya teslim edilmiş sevkiyata yönlendirme yapılamaz' },
        { status: 400 }
      );
    }

    // Zaten yönlendirilmiş olanları kontrol et
    const alreadyRouted = await prisma.shipmentItem.findMany({
      where: { productionRequestId: { in: requestIds } },
      select: { productionRequestId: true, shipment: { select: { name: true } } },
    });
    if (alreadyRouted.length > 0) {
      const names = alreadyRouted.map(r => r.shipment.name).join(', ');
      return NextResponse.json(
        { success: false, error: `${alreadyRouted.length} talep zaten yönlendirilmiş: ${names}` },
        { status: 409 }
      );
    }

    // Destinasyon eşleşmesi: her request'in marketplace'i aynı destinationTab'a gitmeli
    const marketplaceIds = [...new Set(requests.map(r => r.marketplaceId))];
    const routes = await prisma.shippingRoute.findMany({
      where: { marketplaceId: { in: marketplaceIds } },
    });
    const routeMap = new Map(routes.map(r => [r.marketplaceId, r.destinationTab]));

    for (const req of requests) {
      const dest = routeMap.get(req.marketplaceId);
      if (!dest) {
        return NextResponse.json(
          { success: false, error: `${req.iwasku} için shipping route tanımlı değil` },
          { status: 400 }
        );
      }
      if (dest !== shipment.destinationTab) {
        return NextResponse.json(
          { success: false, error: `${req.iwasku} destinasyonu (${dest}) sevkiyat destinasyonuyla (${shipment.destinationTab}) eşleşmiyor` },
          { status: 400 }
        );
      }
    }

    // productSize null olanlar için pricelab_db'den desi çek
    const missingDesiIwaskus = requests
      .filter(r => r.productSize == null)
      .map(r => r.iwasku);

    const desiMap = new Map<string, number>();
    if (missingDesiIwaskus.length > 0) {
      const uniqueIwaskus = [...new Set(missingDesiIwaskus)];
      const placeholders = uniqueIwaskus.map((_, i) => `$${i + 1}`).join(',');
      const rows = await queryProductDb(
        `SELECT p.product_sku AS iwasku, COALESCE(p.manual_size, p.size)::float AS desi
         FROM products p
         WHERE p.product_sku IN (${placeholders}) AND COALESCE(p.manual_size, p.size) IS NOT NULL`,
        uniqueIwaskus
      );
      for (const row of rows) {
        desiMap.set(row.iwasku, row.desi);
      }
    }

    // Transaction: ShipmentItem'lar oluştur
    const items = await prisma.$transaction(
      requests.map(req => {
        const desi = req.productSize ?? desiMap.get(req.iwasku) ?? null;
        return prisma.shipmentItem.create({
          data: {
            shipmentId,
            iwasku: req.iwasku,
            quantity: req.quantity,
            desi,
            marketplaceId: req.marketplaceId,
            productionRequestId: req.id,
          },
        });
      })
    );

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'ROUTE_TO_SHIPMENT',
      entityType: 'Shipment',
      entityId: shipmentId,
      description: `${items.length} talep ${shipment.name} sevkiyatına yönlendirildi`,
      metadata: { requestIds, shipmentName: shipment.name, itemCount: items.length },
    });

    return NextResponse.json({
      success: true,
      data: { routed: items.length, shipmentName: shipment.name },
    });
  } catch (error) {
    return errorResponse(error, 'Sevkiyata yönlendirme başarısız');
  }
}
