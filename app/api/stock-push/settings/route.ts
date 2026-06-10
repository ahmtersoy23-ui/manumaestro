import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';

export const GET = withRoute({ roles: ['admin'] }, async ({ request }) => {
  const channel = new URL(request.url).searchParams.get('channel') ?? 'AMAZON_US';
  const settings = await prisma.stockPushSettings.findUnique({ where: { channel } });
  return NextResponse.json({
    success: true,
    settings: settings ?? { channel, standardQty: 11, enabled: false, dryRun: true },
  });
});

const putSchema = z.object({
  channel: z.string().default('AMAZON_US'),
  standardQty: z.number().int().min(0).max(100000).optional(),
  enabled: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export const PUT = withRoute({ roles: ['admin'], rateLimit: 'write' }, async ({ request }) => {
  const parsed = putSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Geçersiz veri' }, { status: 400 });
  const { channel, standardQty, enabled, dryRun } = parsed.data;
  const settings = await prisma.stockPushSettings.upsert({
    where: { channel },
    create: { channel, standardQty: standardQty ?? 11, enabled: enabled ?? false, dryRun: dryRun ?? true },
    update: {
      ...(standardQty !== undefined ? { standardQty } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(dryRun !== undefined ? { dryRun } : {}),
    },
  });
  return NextResponse.json({ success: true, settings });
});
