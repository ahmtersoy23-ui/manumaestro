/**
 * POST /api/stock-push/cron  (sunucu cron, x-internal-api-key)
 *
 * Zamanlanmış stok push. Her implemente kanal için: settings.enabled İSE canlı
 * runStockPush (diff-based). Pasifse HİÇ çalışmaz (boşa DataBridge/SP-API çağrısı yok).
 * CG sync'inden ~15 dk sonra koşar (taze CG available).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { runStockPush } from '@/lib/stockPush/run';
import { STOCK_PUSH_CHANNELS } from '@/lib/stockPush/constants';
import { createLogger } from '@/lib/logger';

const logger = createLogger('StockPushCron');

export const maxDuration = 600;

export async function POST(request: NextRequest) {
  const key = request.headers.get('x-internal-api-key');
  if (!process.env.MANU_INTERNAL_API_KEY || key !== process.env.MANU_INTERNAL_API_KEY) {
    return NextResponse.json({ success: false, error: 'Yetkisiz' }, { status: 401 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const ch of STOCK_PUSH_CHANNELS) {
    if (!ch.implemented) continue;
    const settings = await prisma.stockPushSettings.findUnique({ where: { channel: ch.key } });
    if (!settings?.enabled) {
      results.push({ channel: ch.key, skipped: 'disabled' });
      continue;
    }
    try {
      const r = await runStockPush(ch.key, { dryRunOverride: false });
      results.push({ channel: ch.key, changed: r.changed, summary: r.summary, tierAZeros: r.tierAZeros.length });
      logger.info(`[cron] ${ch.key} changed=${r.changed} ${JSON.stringify(r.summary)}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error(`[cron] ${ch.key} hata: ${error}`);
      results.push({ channel: ch.key, error });
    }
  }
  return NextResponse.json({ success: true, results });
}
