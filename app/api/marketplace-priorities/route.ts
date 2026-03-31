/**
 * Marketplace Priority API
 * GET: Get priorities for a month
 * POST: Set/update priorities for a month (batch)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { waterfallComplete } from '@/lib/waterfallComplete';
import { z } from 'zod';

const SetPrioritiesSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  priorities: z.array(z.object({
    marketplaceId: z.string().uuid(),
    priority: z.number().int().positive(),
  })).min(1),
});

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;

  const month = new URL(request.url).searchParams.get('month');
  if (!month) {
    return NextResponse.json({ success: false, error: 'month parametresi gerekli' }, { status: 400 });
  }

  const priorities = await prisma.marketplacePriority.findMany({
    where: { month },
    include: { marketplace: { select: { id: true, name: true, code: true, region: true } } },
    orderBy: { priority: 'asc' },
  });

  return NextResponse.json({ success: true, data: priorities });
}

export async function POST(request: NextRequest) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;

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

  return NextResponse.json({
    success: true,
    data: { month, count: priorities.length, waterfallChanged },
  });
}
