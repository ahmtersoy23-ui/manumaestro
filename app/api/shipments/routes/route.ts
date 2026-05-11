/**
 * Shipping Routes API (Settings)
 * GET: List all routes (admin only)
 * POST: Create/update route (admin only)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const RouteSchema = z.object({
  marketplaceId: z.string().uuid(),
  destinationTab: z.enum(['US', 'UK', 'EU', 'NL', 'AU', 'ZA']),
  shippingMethod: z.enum(['sea', 'road', 'air']),
  leadTimeDays: z.number().int().optional(),
  notes: z.string().optional(),
});

export const GET = withRoute({ rateLimit: 'read', roles: ['admin'] }, async () => {
  const routes = await prisma.shippingRoute.findMany({
    include: { marketplace: { select: { id: true, name: true, code: true, region: true } } },
    orderBy: { destinationTab: 'asc' },
  });
  return successResponse(routes);
});

export const POST = withRoute({ rateLimit: 'write', roles: ['admin'] }, async ({ request }) => {
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

  return successResponse(route);
});
