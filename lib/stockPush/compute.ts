/**
 * Stok push hesabi — kanal basina iwasku/SKU hedef adetleri.
 *
 * 3 kova: config'te OLMAYAN iwasku => STANDARD (settings.standardQty) ·
 * config STOCK => secili depo available toplami * yuzde (base < floorX ise 0) ·
 * config ZERO => 0. Amazon'a DOKUNMAZ (sadece lokal hesap) — preview ve run bunu kullanir.
 */
import { prisma, queryProductDb } from '@/lib/db/prisma';
import { getCgAvailability } from '@/lib/wms/cgStock';
import { getUsAvailability } from '@/lib/wms/usWarehouseStock';
import { getChannel } from './constants';

export type EffectiveMode = 'STOCK' | 'STANDARD' | 'ZERO';

export interface StockBreakdown {
  cgMdn: number;
  cgShukran: number;
  nj: number;
  showroom: number;
}

export interface PushTarget {
  marketplaceSku: string;
  iwasku: string;
  mode: EffectiveMode;
  quantity: number;
  breakdown: StockBreakdown;
  /** STOCK: secili depolarin available toplami */
  base?: number;
  /** STOCK: base < floorX => 0 */
  belowFloor?: boolean;
}

export interface ComputeResult {
  channel: string;
  standardQty: number;
  enabled: boolean;
  dryRun: boolean;
  targets: PushTarget[];
  counts: { stock: number; standard: number; zero: number; total: number };
}

export async function computeTargets(channelKey: string): Promise<ComputeResult> {
  const channel = getChannel(channelKey);
  if (!channel) throw new Error(`Bilinmeyen kanal: ${channelKey}`);
  if (!channel.implemented) throw new Error(`${channel.label} henuz desteklenmiyor`);

  const [listings, settings, configs] = await Promise.all([
    queryProductDb(
      `SELECT marketplace_sku, iwasku FROM channel_prices
       WHERE channel_code = $1 AND country_code = $2 AND status = 'Active'
         AND iwasku IS NOT NULL AND iwasku <> ''`,
      [channel.channelCode, channel.country],
    ) as Promise<Array<{ marketplace_sku: string; iwasku: string }>>,
    prisma.stockPushSettings.findUnique({ where: { channel: channelKey } }),
    prisma.stockPushConfig.findMany({ where: { channel: channelKey } }),
  ]);

  const standardQty = settings?.standardQty ?? 11;
  const configByIwasku = new Map(configs.map((c) => [c.iwasku, c]));

  // Stok kaynagi sadece STOCK kovasindaki iwasku'lar icin gerekli (CG + US available)
  const stockIwaskus = configs.filter((c) => c.mode === 'STOCK').map((c) => c.iwasku);
  const [cg, us] = await Promise.all([
    getCgAvailability(stockIwaskus),
    getUsAvailability(stockIwaskus, { subtractPendingDraft: true }),
  ]);

  const targets: PushTarget[] = [];
  for (const l of listings) {
    const cfg = configByIwasku.get(l.iwasku);
    const cgA = cg.get(l.iwasku);
    const usA = us.get(l.iwasku);
    const breakdown: StockBreakdown = {
      cgMdn: cgA?.CG_MDN ?? 0,
      cgShukran: cgA?.CG_SHUKRAN ?? 0,
      nj: usA?.NJ ?? 0,
      showroom: usA?.SHOWROOM ?? 0,
    };

    if (!cfg) {
      targets.push({ marketplaceSku: l.marketplace_sku, iwasku: l.iwasku, mode: 'STANDARD', quantity: standardQty, breakdown });
      continue;
    }
    if (cfg.mode === 'ZERO') {
      targets.push({ marketplaceSku: l.marketplace_sku, iwasku: l.iwasku, mode: 'ZERO', quantity: 0, breakdown });
      continue;
    }
    // STOCK — secili depolarin available toplami
    const wh = cfg.warehouses.length ? cfg.warehouses : ['CG_MDN', 'CG_SHUKRAN', 'NJ', 'SHOWROOM'];
    let base = 0;
    if (wh.includes('CG_MDN')) base += breakdown.cgMdn;
    if (wh.includes('CG_SHUKRAN')) base += breakdown.cgShukran;
    if (wh.includes('NJ')) base += breakdown.nj;
    if (wh.includes('SHOWROOM')) base += breakdown.showroom;
    const belowFloor = base < cfg.floorX;
    const quantity = belowFloor ? 0 : Math.round((base * cfg.percent) / 100);
    targets.push({ marketplaceSku: l.marketplace_sku, iwasku: l.iwasku, mode: 'STOCK', quantity, breakdown, base, belowFloor });
  }

  const counts = {
    stock: targets.filter((t) => t.mode === 'STOCK').length,
    standard: targets.filter((t) => t.mode === 'STANDARD').length,
    zero: targets.filter((t) => t.mode === 'ZERO').length,
    total: targets.length,
  };
  return { channel: channelKey, standardQty, enabled: settings?.enabled ?? false, dryRun: settings?.dryRun ?? true, targets, counts };
}
