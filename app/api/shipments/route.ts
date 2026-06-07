/**
 * Shipments API
 * GET: List shipments (filterable by destinationTab, status)
 * POST: Create new shipment (gemi/TIR)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShipmentView, requireShipmentAction } from '@/lib/auth/requireShipmentRole';
import { getShipmentRole, canDoAction } from '@/lib/auth/shipmentPermission';
import { logAction } from '@/lib/auditLog';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse, createdResponse } from '@/lib/api/response';

const CreateShipmentSchema = z.object({
  name: z.string().min(1).max(100),
  destinationTab: z.enum(['US', 'UK', 'EU', 'NL', 'AU', 'ZA']),
  shippingMethod: z.enum(['sea', 'road', 'air']),
  plannedDate: z.string().datetime().optional(),
  etaDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

// Shipment route'ları destinasyon-bazlı özel yetki sistemi kullanıyor
// (requireShipmentView/Action). withRoute'un generic auth'u skip ediliyor,
// sadece rate-limit + try/catch + errorResponse standartlaşması için.

export const GET = withRoute({ skipAuth: true, rateLimit: 'read' }, async ({ request }) => {
  const authResult = await requireShipmentView(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const destinationTab = searchParams.get('destinationTab');
  const status = searchParams.get('status');

  const shipments = await prisma.shipment.findMany({
    where: {
      ...(destinationTab ? { destinationTab } : {}),
      ...(status ? { status: status as 'PLANNING' | 'LOADING' | 'IN_TRANSIT' | 'DELIVERED' } : {}),
    },
    include: {
      items: { select: { iwasku: true, quantity: true, desi: true, marketplaceId: true } },
      _count: { select: { items: true, boxes: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const shipmentsWithStats = shipments.map(s => {
    const totalQty = s.items.reduce((sum, i) => sum + i.quantity, 0);
    const totalDesi = s.items.reduce((sum, i) => sum + (i.desi ?? 0) * i.quantity, 0);
    const { items: _items, ...shipmentData } = s;
    return {
      ...shipmentData,
      stats: { itemCount: s._count.items, boxCount: s._count.boxes, totalQty, totalDesi: Math.round(totalDesi) },
    };
  });

  const destTab = destinationTab ?? 'US';
  const userShipRole = await getShipmentRole(authResult.user.id, authResult.user.role, destTab);
  const canCreate = canDoAction(userShipRole, 'createShipment');

  return successResponse(shipmentsWithStats, { permissions: { canCreate } });
});

export const POST = withRoute({ skipAuth: true, rateLimit: 'write' }, async ({ request }) => {
  const body = await request.json();
  const validation = CreateShipmentSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const data = validation.data;

  const authResult = await requireShipmentAction(request, data.destinationTab, 'createShipment');
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  const shipment = await prisma.shipment.create({
    data: {
      name: data.name,
      destinationTab: data.destinationTab,
      shippingMethod: data.shippingMethod,
      plannedDate: data.plannedDate ? new Date(data.plannedDate) : null,
      etaDate: data.etaDate ? new Date(data.etaDate) : null,
      notes: data.notes,
      createdById: user.id,
    },
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'CREATE_REQUEST', entityType: 'Shipment', entityId: shipment.id,
    description: `Sevkiyat oluşturuldu: ${shipment.name} (${shipment.destinationTab})`,
  });

  return createdResponse(shipment);
});
