/**
 * Marketplace Priority API
 * GET: Get priorities for a month (admin only)
 * POST: Set/update priorities for a month (admin only, triggers waterfall)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { waterfallComplete } from '@/lib/waterfallComplete';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const SetPrioritiesSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  priorities: z.array(z.object({
    marketplaceId: z.string().uuid(),
    priority: z.number().int().positive(),
  })).min(1),
});

export const GET = withRoute({ rateLimit: 'read', roles: ['admin'] }, async ({ request }) => {
  const month = new URL(request.url).searchParams.get('month');
  if (!month) {
    return NextResponse.json({ success: false, error: 'month parametresi gerekli' }, { status: 400 });
  }

  const priorities = await prisma.marketplacePriority.findMany({
    where: { month },
    include: { marketplace: { select: { id: true, name: true, code: true, region: true } } },
    orderBy: { priority: 'asc' },
  });

  return successResponse(priorities);
});

export const POST = withRoute({ rateLimit: 'write', roles: ['admin'] }, async ({ request }) => {
  const body = await request.json();
  const validation = SetPrioritiesSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { month, priorities } = validation.data;

  // Upsert all priorities in transaction
  await prisma.$transaction(async (tx) => {
    for (const p of priorities) {
      await tx.marketplacePriority.upsert({
        where: { month_marketplaceId: { month, marketplaceId: p.marketplaceId } },
        create: { month, marketplaceId: p.marketplaceId, priority: p.priority },
        update: { priority: p.priority },
      });
    }
  });

  // Trigger waterfall for all iwaskus in this month
  const distinctIwaskus = await prisma.productionRequest.findMany({
    where: { productionMonth: month },
    select: { iwasku: true },
    distinct: ['iwasku'],
  });

  let waterfallChanged = 0;
  for (const { iwasku } of distinctIwaskus) {
    waterfallChanged += await waterfallComplete(iwasku, month);
  }

  return successResponse({ month, count: priorities.length, waterfallChanged });
});
