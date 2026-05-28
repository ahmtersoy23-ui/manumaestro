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
import { prisma, queryProductDb } from '@/lib/db/prisma';
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
}

/** marketplace_code → sales_data.channel mapping (L30/L90 enrichment için). */
function marketplaceToChannel(code: string): string | null {
  if (code.startsWith('AMZN_')) {
    return code.slice(5).toLowerCase(); // AMZN_US → us, AMZN_UK → uk
  }
  // US non-FBA marketplace'ler (NJ_DEPO altındakiler) → us
  if (['NJ_DEPO', 'WAYFAIR_US', 'CUSTOM_01', 'CUSTOM_03', 'CUSTOM_05', 'CUSTOM_07'].includes(code)) {
    return 'us';
  }
  if (['UK_DEPO', 'WAYFAIR_UK', 'CUSTOM_04'].includes(code)) return 'uk';
  if (['EU_NL_DEPO', 'BOL_NL', 'CUSTOM_02'].includes(code)) return 'eu';
  if (code === 'TAKEALOT_ZA') return 'za';
  if (code === 'CUSTOM_06') return 'tr';
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

    // 4. L30/L90/L180 enrichment for REQUESTS (suggestions zaten dolu)
    // Tek query: tüm iwasku + channel kombinasyonları için sales_data
    const requestSalesKeys = new Set<string>();
    requests.forEach(r => {
      const mp = mpById.get(r.marketplaceId);
      if (!mp) return;
      const channel = marketplaceToChannel(mp.code);
      if (channel) requestSalesKeys.add(`${r.iwasku}|${channel}`);
    });

    const salesMap = new Map<string, { l30: number; l90: number; l180: number }>();
    if (requestSalesKeys.size > 0) {
      const iwaskus = [...new Set(requests.map(r => r.iwasku))];
      const channels = [...new Set(
        requests.map(r => marketplaceToChannel(mpById.get(r.marketplaceId)?.code ?? '')).filter(Boolean) as string[],
      )];
      if (iwaskus.length > 0 && channels.length > 0) {
        const rows = await queryProductDb(
          `SELECT iwasku, channel, last30, last90, last180
           FROM sales_data
           WHERE iwasku = ANY($1::text[])
             AND channel = ANY($2::text[])
             AND fulfillment_channel IS NULL`,
          [iwaskus as unknown as string, channels as unknown as string],
        );
        for (const row of rows as Array<{ iwasku: string; channel: string; last30: number; last90: number; last180: number }>) {
          salesMap.set(`${row.iwasku}|${row.channel}`, {
            l30: row.last30 ?? 0,
            l90: row.last90 ?? 0,
            l180: row.last180 ?? 0,
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
      });
    }

    for (const r of requests) {
      const mp = mpById.get(r.marketplaceId);
      if (!mp) continue;
      const channel = marketplaceToChannel(mp.code);
      const sales = channel ? salesMap.get(`${r.iwasku}|${channel}`) : null;
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
