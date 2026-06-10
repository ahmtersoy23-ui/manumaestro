import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withRoute } from '@/lib/api/withRoute';
import { computeTargets } from '@/lib/stockPush/compute';

/**
 * Onizleme — lokal hesap (Amazon'a DOKUNMAZ). Her FBM SKU icin hedef adet + kova +
 * stok kirilimi + son push'a (state) gore degisecek mi. Hizli; UI'in ana araci.
 */
export const GET = withRoute({ roles: ['admin'], fallbackMessage: 'Önizleme hesaplanamadı' }, async ({ request }) => {
  const channel = new URL(request.url).searchParams.get('channel') ?? 'AMAZON_US';
  const [comp, states] = await Promise.all([
    computeTargets(channel),
    prisma.stockPushState.findMany({ where: { channel }, select: { marketplaceSku: true, lastQty: true } }),
  ]);
  const last = new Map(states.map((s) => [s.marketplaceSku, s.lastQty]));

  const rows = comp.targets.map((t) => {
    const lastQty = last.get(t.marketplaceSku) ?? null;
    return { ...t, lastQty, willChange: lastQty === null || lastQty !== t.quantity };
  });
  const changedCount = rows.filter((r) => r.willChange).length;

  return NextResponse.json({
    success: true,
    channel,
    standardQty: comp.standardQty,
    enabled: comp.enabled,
    dryRun: comp.dryRun,
    counts: comp.counts,
    changedCount,
    rows,
  });
});
