import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { STOCK_WAREHOUSES } from '@/lib/stockPush/constants';
import { ensureStock } from '@/lib/stockPush/access';

export const GET = withRoute({ rateLimit: 'read' }, async ({ user, request }) => {
  const deny = await ensureStock(user, 'view');
  if (deny) return deny;
  const channel = new URL(request.url).searchParams.get('channel') ?? 'AMAZON_US';
  const configs = await prisma.stockPushConfig.findMany({
    where: { channel },
    orderBy: [{ mode: 'asc' }, { iwasku: 'asc' }],
  });
  return NextResponse.json({ success: true, configs });
});

const postSchema = z.object({
  channel: z.string().default('AMAZON_US'),
  iwasku: z.string().trim().min(1),
  mode: z.enum(['STOCK', 'ZERO']),
  warehouses: z.array(z.enum(STOCK_WAREHOUSES)).optional(),
  percent: z.number().int().min(0).max(100).optional(),
  floorX: z.number().int().min(0).max(100000).optional(),
  note: z.string().max(500).optional(),
});

export const POST = withRoute({ rateLimit: 'write' }, async ({ user, request }) => {
  const deny = await ensureStock(user, 'edit');
  if (deny) return deny;
  const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Geçersiz veri' }, { status: 400 });
  const { channel, iwasku, mode, warehouses, percent, floorX, note } = parsed.data;
  const config = await prisma.stockPushConfig.upsert({
    where: { channel_iwasku: { channel, iwasku } },
    create: {
      channel,
      iwasku,
      mode,
      warehouses: warehouses ?? [...STOCK_WAREHOUSES],
      percent: percent ?? 100,
      floorX: floorX ?? 0,
      note: note ?? null,
    },
    update: {
      mode,
      ...(warehouses !== undefined ? { warehouses } : {}),
      ...(percent !== undefined ? { percent } : {}),
      ...(floorX !== undefined ? { floorX } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  });
  return NextResponse.json({ success: true, config });
});

export const DELETE = withRoute({ rateLimit: 'write' }, async ({ user, request }) => {
  const deny = await ensureStock(user, 'edit');
  if (deny) return deny;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'id gerekli' }, { status: 400 });
  await prisma.stockPushConfig.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ success: true });
});
