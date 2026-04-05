/**
 * Shipments API
 * GET: List shipments (filterable by destinationTab, status)
 * POST: Create new shipment (gemi/TIR)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';

const CreateShipmentSchema = z.object({
  name: z.string().min(1).max(100),
  destinationTab: z.enum(['US', 'UK', 'EU', 'NL', 'AU', 'ZA']),
  shippingMethod: z.enum(['sea', 'road', 'air']),
  plannedDate: z.string().datetime(),
  etaDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['admin']);
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
      items: {
        select: { iwasku: true, quantity: true, desi: true, marketplaceId: true },
      },
      _count: { select: { items: true } },
    },
    orderBy: { plannedDate: 'desc' },
    take: 100,
  });

  const shipmentsWithStats = shipments.map(s => {
    const totalQty = s.items.reduce((sum, i) => sum + i.quantity, 0);
    const totalDesi = s.items.reduce((sum, i) => sum + (i.desi ?? 0) * i.quantity, 0);
    const { items: _items, ...shipmentData } = s;
    return {
      ...shipmentData,
      stats: {
        itemCount: s._count.items,
        totalQty,
        totalDesi: Math.round(totalDesi),
      },
    };
  });

  return NextResponse.json({ success: true, data: shipmentsWithStats });
}

export async function POST(request: NextRequest) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  const body = await request.json();
  const validation = CreateShipmentSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const data = validation.data;

  const shipment = await prisma.shipment.create({
    data: {
      name: data.name,
      destinationTab: data.destinationTab,
      shippingMethod: data.shippingMethod,
      plannedDate: new Date(data.plannedDate),
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

  return NextResponse.json({ success: true, data: shipment }, { status: 201 });
}
