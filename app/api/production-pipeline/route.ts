/**
 * GET /api/production-pipeline
 *
 * V2 sayfası için birleşik üretim talebi listesi:
 *   - production_suggestions (status=PENDING) → AUTO badge
 *   - production_requests (status open) → AUTO ✓ / MANUEL / EXCEL badge
 *
 * Filtreler: region (US/UK/EU/OTHER), productionMonth, status, q (search)
 *
 * Region filter: client lib/marketplaceRegions.ts'teki DESTINATIONS_BY_REGION
 * + DETAIL_CHANNELS_BY_DESTINATION birlikte. Yani US tab: AMZN_US + NJ_DEPO +
 * WAYFAIR_US + CUSTOM_01/03/05/07 (alt-detay) marketplaces hepsi.
 */

import { Prisma } from '@prisma/client';
import { prisma, queryProductDb, queryDataBridge } from '@/lib/db/prisma';
import { isSuperAdmin } from '@/lib/auth/verify';
import { successResponse } from '@/lib/api/response';
import { withRoute } from '@/lib/api/withRoute';
import {
  DESTINATIONS_BY_REGION,
  DETAIL_CHANNELS_BY_DESTINATION,
  REGIONS,
  type Region,
} from '@/lib/marketplaceRegions';

interface PipelineItem {
  type: 'suggestion' | 'request';
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  productSize: number | null;
  marketplaceId: string;
  marketplaceCode: string;
  marketplaceName: string;
  productionMonth: string;
  quantity: number;
  priority: string | null;
  status: string;
  source: 'AUTO' | 'AUTO_ACCEPTED' | 'MANUAL' | 'EXCEL';
  l30: number;
  l90: number;
  l180: number;
  formulaVersion: string | null;
  reasoning: string | null;
  createdAt: string;
  notes: string | null;
  recommendedDestination: string | null;
}

/**
 * marketplace_code → satış kaynağı çözümleme (L30/L90 enrichment için).
 *
 * StockPulse snapshot job aynı kaynakları kullanır (server/services/salesAggregator.cjs):
 *   - sales_data: Amazon, Walmart, Wayfair, Bol, Kaufland, Takealot
 *   - databridge.raw_orders: Wisersell-only (Shopify/CITI/Etsy/Ebay/Trendyol)
 *
 * Eski destinasyon-bazlı marketplace'ler (NJ_DEPO/UK_DEPO/EU_NL_DEPO) için fallback
 * Amazon birleşik kullanılır — yeni pazar yeri-bazlı PR'lar geldiğinde otomatik
 * doğru kaynaktan beslenir.
 */
type SalesSource =
  | { kind: 'sales_data'; channels: string[] }
  | { kind: 'wisersell'; pattern: string; ulke: string };

function marketplaceToSource(code: string): SalesSource | null {
  // sales_data tarafı
  if (code === 'AMZN_US' || code === 'NJ_DEPO') return { kind: 'sales_data', channels: ['us'] };
  if (code === 'AMZN_UK' || code === 'UK_DEPO') return { kind: 'sales_data', channels: ['uk'] };
  if (code === 'AMZN_EU' || code === 'EU_NL_DEPO') return { kind: 'sales_data', channels: ['eu'] };
  if (code === 'AMZN_CA') return { kind: 'sales_data', channels: ['ca'] };
  if (code === 'AMZN_AU') return { kind: 'sales_data', channels: ['au'] };
  if (code === 'WAYFAIR_US') return { kind: 'sales_data', channels: ['wfs', 'wfm'] };
  if (code === 'CUSTOM_05') return { kind: 'sales_data', channels: ['walmart'] };
  if (code === 'CUSTOM_02') return { kind: 'sales_data', channels: ['kaufland_de', 'kaufland_at', 'kaufland_pl', 'kaufland_cz', 'kaufland_sk'] };
  if (code === 'BOL_NL') return { kind: 'sales_data', channels: ['bol_pera', 'bol_onebv'] };
  if (code === 'TAKEALOT_ZA') return { kind: 'sales_data', channels: ['takealot'] };

  // Wisersell raw_orders tarafı (LIKE pattern + ulke filter)
  if (code === 'CUSTOM_01') return { kind: 'wisersell', pattern: 'Ama_CITI', ulke: 'United States' };
  if (code === 'CUSTOM_03') return { kind: 'wisersell', pattern: 'Etsy%', ulke: 'United States' };
  if (code === 'CUSTOM_04') return { kind: 'wisersell', pattern: 'eBay%', ulke: 'United Kingdom' };
  if (code === 'CUSTOM_06') return { kind: 'wisersell', pattern: 'T\\_%', ulke: 'Turkiye' };
  if (code === 'CUSTOM_07') return { kind: 'wisersell', pattern: 'S\\_%', ulke: 'United States' };

  return null;
}

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Pipeline getirilemedi' },
  async ({ request, user }) => {
    const sp = request.nextUrl.searchParams;
    const region = sp.get('region') as Region | null;
    const productionMonth = sp.get('productionMonth');
    const status = sp.get('status'); // suggestion: PENDING/ACCEPTED/DISMISSED, request: REQUESTED/IN_PROD/...
    const q = sp.get('q');

    // Region için marketplace code listesi (1. + 2. barem hepsi)
    let marketplaceCodes: string[] | undefined;
    if (region && REGIONS.includes(region)) {
      const destinations = DESTINATIONS_BY_REGION[region] ?? [];
      const details = destinations.flatMap(d => DETAIL_CHANNELS_BY_DESTINATION[d] ?? []);
      marketplaceCodes = [...destinations, ...details];
    }

    // Marketplace lookup (code → id, name)
    const marketplacesWhere: Prisma.MarketplaceWhereInput = { isActive: true };
    if (marketplaceCodes) marketplacesWhere.code = { in: marketplaceCodes };
    const marketplaces = await prisma.marketplace.findMany({
      where: marketplacesWhere,
      select: { id: true, code: true, name: true },
    });
    const allowedMarketplaceIds = marketplaces.map(m => m.id);
    const mpById = new Map(marketplaces.map(m => [m.id, m]));

    if (allowedMarketplaceIds.length === 0) {
      return successResponse({ items: [], total: 0 });
    }

    // Marketplace yetki filtresi (super-admin bypass)
    const userIsSuperAdmin = isSuperAdmin(user!.email);
    let userAllowedIds: string[] | null = null;
    if (!userIsSuperAdmin && user!.role !== 'admin') {
      const perms = await prisma.userMarketplacePermission.findMany({
        where: { userId: user!.id, canView: true, marketplaceId: { in: allowedMarketplaceIds } },
        select: { marketplaceId: true },
      });
      userAllowedIds = perms.map(p => p.marketplaceId);
      if (userAllowedIds.length === 0) {
        return successResponse({ items: [], total: 0 });
      }
    }
    const effectiveMarketplaceIds = userAllowedIds ?? allowedMarketplaceIds;

    // 1. Suggestions (PENDING)
    const suggestionsWhere: Prisma.ProductionSuggestionWhereInput = {
      marketplaceId: { in: effectiveMarketplaceIds },
      status: 'PENDING',
    };
    if (productionMonth) suggestionsWhere.productionMonth = productionMonth;
    if (q) {
      suggestionsWhere.OR = [
        { iwasku: { contains: q, mode: 'insensitive' } },
        { productName: { contains: q, mode: 'insensitive' } },
      ];
    }
    const suggestions = await prisma.productionSuggestion.findMany({
      where: suggestionsWhere,
      take: 2000,
    });

    // 2. Requests (açık olanlar — COMPLETED/CANCELLED hariç)
    const requestsWhere: Prisma.ProductionRequestWhereInput = {
      marketplaceId: { in: effectiveMarketplaceIds },
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    };
    if (productionMonth) requestsWhere.productionMonth = productionMonth;
    if (status === 'REQUESTED' || status === 'IN_PRODUCTION' || status === 'PARTIALLY_PRODUCED') {
      requestsWhere.status = status;
    }
    if (q) {
      requestsWhere.OR = [
        { iwasku: { contains: q, mode: 'insensitive' } },
        { productName: { contains: q, mode: 'insensitive' } },
      ];
    }
    const requests = await prisma.productionRequest.findMany({
      where: requestsWhere,
      take: 2000,
      orderBy: { createdAt: 'desc' },
    });

    // 3. Status filter sadece suggestion için (PENDING vs ACCEPTED vs DISMISSED)
    const visibleSuggestions = status && ['PENDING', 'ACCEPTED', 'DISMISSED', 'EXPIRED'].includes(status)
      ? suggestions.filter(s => s.status === status)
      : (status ? [] : suggestions); // status= REQUESTED/IN_PROD ise suggestion gösterme

    // 4. L30/L90/L180 enrichment for REQUESTS (suggestions zaten dolu).
    // Pazar yeri-bazlı kaynak çözümü: salesMap key = iwasku|marketplaceCode.
    // sales_data kanalları tek sorgu + marketplace bazlı SUM; Wisersell-only
    // pazar yerleri (Etsy/Shopify/CITI/Ebay/Trendyol) için ayrı raw_orders sorgusu.
    const salesMap = new Map<string, { l30: number; l90: number; l180: number }>();
    const iwaskus = [...new Set(requests.map(r => r.iwasku))];
    const usedCodes = new Set<string>();
    requests.forEach(r => {
      const mp = mpById.get(r.marketplaceId);
      if (mp) usedCodes.add(mp.code);
    });

    if (iwaskus.length > 0 && usedCodes.size > 0) {
      // sales_data tarafı: tüm gerekli channel'ları topla, channel→code geri eşleme.
      const allChannels = new Set<string>();
      const channelToCode = new Map<string, string>();
      const wisersellCodes: Array<{ code: string; pattern: string; ulke: string }> = [];
      for (const code of usedCodes) {
        const src = marketplaceToSource(code);
        if (!src) continue;
        if (src.kind === 'sales_data') {
          for (const ch of src.channels) {
            allChannels.add(ch);
            channelToCode.set(ch, code);
          }
        } else {
          wisersellCodes.push({ code, pattern: src.pattern, ulke: src.ulke });
        }
      }

      if (allChannels.size > 0) {
        const rows = await queryProductDb(
          `SELECT iwasku, channel, last30, last90, last180
           FROM sales_data
           WHERE iwasku = ANY($1::text[])
             AND channel = ANY($2::text[])
             AND fulfillment_channel IS NULL`,
          [iwaskus as unknown as string, [...allChannels] as unknown as string],
        );
        for (const row of rows as Array<{ iwasku: string; channel: string; last30: number; last90: number; last180: number }>) {
          const code = channelToCode.get(row.channel);
          if (!code) continue;
          const key = `${row.iwasku}|${code}`;
          const ex = salesMap.get(key) ?? { l30: 0, l90: 0, l180: 0 };
          salesMap.set(key, {
            l30: ex.l30 + (row.last30 ?? 0),
            l90: ex.l90 + (row.last90 ?? 0),
            l180: ex.l180 + (row.last180 ?? 0),
          });
        }
      }

      // Wisersell raw_orders: her marketplaceCode için ayrı sorgu (LIKE pattern + ulke).
      for (const { code, pattern, ulke } of wisersellCodes) {
        const rows = await queryDataBridge(
          `SELECT iwasku,
                  SUM(CASE WHEN siparis_tarihi >= CURRENT_DATE - 30  THEN adet ELSE 0 END)::int AS l30,
                  SUM(CASE WHEN siparis_tarihi >= CURRENT_DATE - 90  THEN adet ELSE 0 END)::int AS l90,
                  SUM(CASE WHEN siparis_tarihi >= CURRENT_DATE - 180 THEN adet ELSE 0 END)::int AS l180
           FROM wisersell_orders
           WHERE iwasku = ANY($1::text[])
             AND ulke = $2
             AND platform LIKE $3 ESCAPE '\\'
           GROUP BY iwasku`,
          [iwaskus, ulke, pattern],
        );
        for (const row of rows as Array<{ iwasku: string; l30: number; l90: number; l180: number }>) {
          salesMap.set(`${row.iwasku}|${code}`, {
            l30: row.l30 ?? 0,
            l90: row.l90 ?? 0,
            l180: row.l180 ?? 0,
          });
        }
      }
    }

    // 5. Birleştir
    const items: PipelineItem[] = [];

    for (const s of visibleSuggestions) {
      const mp = mpById.get(s.marketplaceId);
      if (!mp) continue;
      items.push({
        type: 'suggestion',
        id: s.id,
        iwasku: s.iwasku,
        productName: s.productName,
        productCategory: s.productCategory,
        productSize: s.productSize,
        marketplaceId: s.marketplaceId,
        marketplaceCode: mp.code,
        marketplaceName: mp.name,
        productionMonth: s.productionMonth,
        quantity: s.suggestedQty,
        priority: null,
        status: s.status,
        source: 'AUTO',
        l30: s.l30,
        l90: s.l90,
        l180: s.l180,
        formulaVersion: s.formulaVersion,
        reasoning: s.reasoning,
        createdAt: s.syncedAt.toISOString(),
        notes: null,
        recommendedDestination: null, // suggestion'da kolon yok — PR'a accept edilince yazılır
      });
    }

    for (const r of requests) {
      const mp = mpById.get(r.marketplaceId);
      if (!mp) continue;
      const sales = salesMap.get(`${r.iwasku}|${mp.code}`);
      let source: PipelineItem['source'] = 'MANUAL';
      if (r.entryType === 'STOCKPULSE') source = 'AUTO_ACCEPTED';
      else if (r.entryType === 'EXCEL') source = 'EXCEL';

      items.push({
        type: 'request',
        id: r.id,
        iwasku: r.iwasku,
        productName: r.productName,
        productCategory: r.productCategory,
        productSize: r.productSize,
        marketplaceId: r.marketplaceId,
        marketplaceCode: mp.code,
        marketplaceName: mp.name,
        productionMonth: r.productionMonth,
        quantity: r.quantity,
        priority: r.priority,
        status: r.status,
        source,
        l30: sales?.l30 ?? 0,
        l90: sales?.l90 ?? 0,
        l180: sales?.l180 ?? 0,
        formulaVersion: null,
        reasoning: null,
        createdAt: r.createdAt.toISOString(),
        notes: r.notes,
        recommendedDestination: r.recommendedDestination,
      });
    }

    // Sıralama: 1. barem (destinasyon) önce → iwasku → ürün adı
    const destOrder = new Map<string, number>();
    REGIONS.forEach(reg => {
      DESTINATIONS_BY_REGION[reg].forEach((code, idx) => destOrder.set(code, idx));
    });
    items.sort((a, b) => {
      const da = destOrder.get(a.marketplaceCode) ?? 999;
      const db = destOrder.get(b.marketplaceCode) ?? 999;
      if (da !== db) return da - db;
      return a.iwasku.localeCompare(b.iwasku);
    });

    return successResponse({
      items,
      total: items.length,
      counts: {
        suggestions: visibleSuggestions.length,
        requests: requests.length,
      },
    });
  },
);
