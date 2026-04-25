/**
 * Shipping Routes API (Settings)
 * GET: List all routes
 * POST: Create/update route
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { z } from 'zod';

const RouteSchema = z.object({
  marketplaceId: z.string().uuid(),
  destinationTab: z.enum(['US', 'UK', 'EU', 'NL', 'AU', 'ZA']),
  shippingMethod: z.enum(['sea', 'road', 'air']),
  leadTimeDays: z.number().int().optional(),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;

  const routes = await prisma.shippingRoute.findMany({
    include: { marketplace: { select: { id: true, name: true, code: true, region: true } } },
    orderBy: { destinationTab: 'asc' },
  });

  return NextResponse.json({ success: true, data: routes });
}

export async function POST(request: NextRequest) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const validation = RouteSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const data = validation.data;

  const route = await prisma.shippingRoute.upsert({
    where: { marketplaceId: data.marketplaceId },
    create: data,
    update: {
      destinationTab: data.destinationTab,
      shippingMethod: data.shippingMethod,
      leadTimeDays: data.leadTimeDays,
      notes: data.notes,
    },
  });

  return NextResponse.json({ success: true, data: route });
}
