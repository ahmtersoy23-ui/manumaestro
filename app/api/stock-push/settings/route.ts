import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { ensureStock, ensureAdmin } from '@/lib/stockPush/access';

export const GET = withRoute({ rateLimit: 'read' }, async ({ user, request }) => {
  const deny = await ensureStock(user, 'view');
  if (deny) return deny;
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

export const PUT = withRoute({ rateLimit: 'write' }, async ({ user, request }) => {
  const parsed = putSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Geçersiz veri' }, { status: 400 });
  const { channel, standardQty, enabled, dryRun } = parsed.data;
  // Aktif/Pasif (enabled) ve dryRun = SADECE admin; standart adet = edit (pazaryeri ilgilisi).
  const deny = enabled !== undefined || dryRun !== undefined ? ensureAdmin(user) : await ensureStock(user, 'edit');
  if (deny) return deny;
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
