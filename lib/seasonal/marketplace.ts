/**
 * Marketplace split → Region split dönüşümü.
 *
 * DB: stock_reserves.marketplaceSplit artık marketplace.code bazlı
 *   { "AMZN_US": 500, "WAYFAIR_US": 151, "BOL_NL": 30 }
 *
 * Allocator ise region bazlı split bekler (DESTINATION_LEAD_TIMES bölge anahtarlı).
 * Bu helper Marketplace tablosundan code→region map'i alıp split'i bölgeye toplar.
 *
 * Bilinmeyen code (örn. migration öncesi region keyli eski kayıt) olduğu gibi bırakılır.
 */

import { prisma } from '@/lib/db/prisma';

export type MarketplaceCodeRegionMap = Map<string, string>;

export async function loadCodeToRegionMap(): Promise<MarketplaceCodeRegionMap> {
  const rows = await prisma.marketplace.findMany({
    where: { isActive: true },
    select: { code: true, region: true },
  });
  return new Map(rows.map(m => [m.code, m.region]));
}

export function marketplaceSplitToRegionSplit(
  mpSplit: Record<string, number> | null | undefined,
  codeToRegion: MarketplaceCodeRegionMap,
): Record<string, number> {
  if (!mpSplit) return {};
  const out: Record<string, number> = {};
  for (const [code, qty] of Object.entries(mpSplit)) {
    if (!qty || qty <= 0) continue;
    const region = codeToRegion.get(code) ?? code;
    out[region] = (out[region] ?? 0) + qty;
  }
  return out;
}
