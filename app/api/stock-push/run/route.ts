import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute } from '@/lib/api/withRoute';
import { runStockPush } from '@/lib/stockPush/run';

// Ilk canli kosu tum SKU'lari dolasabilir (chunk'li, dakikalar surebilir) — limit yok.
export const maxDuration = 600;

const bodySchema = z.object({
  channel: z.string().default('AMAZON_US'),
  /** true=zorla dry-run, false=canli (yalniz settings.enabled iken gecerli), bos=settings.dryRun */
  dryRun: z.boolean().optional(),
});

export const POST = withRoute({ roles: ['admin'], rateLimit: false, fallbackMessage: 'Push çalıştırılamadı' }, async ({ request }) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Geçersiz veri' }, { status: 400 });
  const { channel, dryRun } = parsed.data;
  const result = await runStockPush(channel, { dryRunOverride: dryRun });
  return NextResponse.json({ success: true, ...result });
});
