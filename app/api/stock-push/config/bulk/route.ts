import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { STOCK_WAREHOUSES } from '@/lib/stockPush/constants';
import { ensureStock } from '@/lib/stockPush/access';

/**
 * Toplu kova atama. Alttaki listeden seçili iwasku'lara tek seferde uygular:
 *   mode=STOCK/ZERO → upsert · mode=null → config sil (STANDARD'a dön).
 */
const schema = z.object({
  channel: z.string().default('AMAZON_US'),
  iwaskus: z.array(z.string().trim().min(1)).min(1).max(5000),
  mode: z.enum(['STOCK', 'ZERO']).nullable(),
  warehouses: z.array(z.enum(STOCK_WAREHOUSES)).optional(),
  percent: z.number().int().min(0).max(100).optional(),
  floorX: z.number().int().min(0).max(100000).optional(),
  handlingDays: z.number().int().min(0).max(60).nullable().optional(),
  note: z.string().max(500).optional(),
});

export const POST = withRoute({ rateLimit: 'write' }, async ({ user, request }) => {
  const deny = await ensureStock(user, 'edit');
  if (deny) return deny;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Geçersiz veri' }, { status: 400 });
  const { channel, iwaskus, mode, warehouses, percent, floorX, handlingDays, note } = parsed.data;
  const unique = [...new Set(iwaskus.map((s) => s.trim()).filter(Boolean))];

  if (mode === null) {
    const { count } = await prisma.stockPushConfig.deleteMany({ where: { channel, iwasku: { in: unique } } });
    return NextResponse.json({ success: true, action: 'removed', count });
  }

  const wh = mode === 'STOCK' ? (warehouses ?? [...STOCK_WAREHOUSES]) : [];
  const p = percent ?? 100;
  const f = floorX ?? 0;
  const h = handlingDays ?? null;
  const ops = unique.map((iwasku) =>
    prisma.stockPushConfig.upsert({
      where: { channel_iwasku: { channel, iwasku } },
      create: { channel, iwasku, mode, warehouses: wh, percent: p, floorX: f, handlingDays: h, note: note ?? null },
      update: { mode, warehouses: wh, percent: p, floorX: f, handlingDays: h, ...(note !== undefined ? { note } : {}) },
    }),
  );
  let count = 0;
  for (let i = 0; i < ops.length; i += 100) {
    const res = await prisma.$transaction(ops.slice(i, i + 100));
    count += res.length;
  }
  return NextResponse.json({ success: true, action: 'upserted', count });
});
