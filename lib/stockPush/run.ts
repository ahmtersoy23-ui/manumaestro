/**
 * Stok push calistirici. compute → state ile diff (sadece degisen SKU) → DataBridge
 * push → canli ise state guncelle. Tier-A (STOCK) bir SKU 0'a transition ederse Slack
 * alarmi (gozden kacmasin). Hem /run route'u hem (ileride) cron bunu cagirir.
 *
 * Guvenlik: canli push SADECE settings.enabled iken; aksi halde zorla dry-run.
 */
import { prisma } from '@/lib/db/prisma';
import { computeTargets } from './compute';
import { pushAmazonListings, type PushItem, type PushResultRow } from './databridgeClient';

export interface RunResult {
  channel: string;
  enabled: boolean;
  dryRun: boolean;
  changed: number;
  summary: { total: number; pushed: number; skipped: number; dryrun: number; failed: number };
  results: PushResultRow[];
  tierAZeros: string[];
}

export async function runStockPush(channelKey: string, opts: { dryRunOverride?: boolean } = {}): Promise<RunResult> {
  const comp = await computeTargets(channelKey);
  // Canli push sadece enabled iken; degilse her zaman dry-run (override olsa bile)
  const wantDryRun = opts.dryRunOverride ?? comp.dryRun;
  const effectiveDryRun = comp.enabled ? wantDryRun : true;

  const states = await prisma.stockPushState.findMany({ where: { channel: channelKey } });
  const lastBySku = new Map(states.map((s) => [s.marketplaceSku, s.lastQty]));

  const changedItems: PushItem[] = [];
  const tierAZeros: string[] = [];
  for (const t of comp.targets) {
    const prev = lastBySku.get(t.marketplaceSku);
    if (prev !== undefined && prev === t.quantity) continue; // degismemis
    changedItems.push({ sku: t.marketplaceSku, quantity: t.quantity });
    if (t.mode === 'STOCK' && t.quantity === 0 && (prev === undefined || prev > 0)) {
      tierAZeros.push(t.marketplaceSku);
    }
  }

  if (changedItems.length === 0) {
    return {
      channel: channelKey,
      enabled: comp.enabled,
      dryRun: effectiveDryRun,
      changed: 0,
      summary: { total: 0, pushed: 0, skipped: 0, dryrun: 0, failed: 0 },
      results: [],
      tierAZeros: [],
    };
  }

  const alert = tierAZeros.length
    ? `${tierAZeros.length} stok-takipli SKU 0'a indi: ${tierAZeros.slice(0, 20).join(', ')}${tierAZeros.length > 20 ? ' …' : ''}`
    : undefined;

  const push = await pushAmazonListings(changedItems, { dryRun: effectiveDryRun, alert });

  // Canli + basarili (pushed/skipped) SKU'lar icin state'i hedefe guncelle
  if (!effectiveDryRun) {
    const targetBySku = new Map(comp.targets.map((t) => [t.marketplaceSku, t]));
    const ops = push.results
      .filter((r) => r.status === 'pushed' || r.status === 'skipped')
      .map((r) => {
        const t = targetBySku.get(r.sku);
        if (!t) return null;
        return prisma.stockPushState.upsert({
          where: { channel_marketplaceSku: { channel: channelKey, marketplaceSku: r.sku } },
          create: { channel: channelKey, marketplaceSku: r.sku, iwasku: t.iwasku, lastQty: t.quantity },
          update: { lastQty: t.quantity, iwasku: t.iwasku, lastPushedAt: new Date() },
        });
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    for (let i = 0; i < ops.length; i += 50) await prisma.$transaction(ops.slice(i, i + 50));
  }

  return {
    channel: channelKey,
    enabled: comp.enabled,
    dryRun: effectiveDryRun,
    changed: changedItems.length,
    summary: push.summary,
    results: push.results,
    tierAZeros,
  };
}
