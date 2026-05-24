/**
 * GET /api/production-suggestions
 * Listing — filter: marketplaceId, productionMonth, status, category, q (search)
 * Marketplace izni: ADMIN tümünü; OPERATOR sadece canView verilen marketplace'ler.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { isSuperAdmin } from '@/lib/auth/verify';
import { successResponse } from '@/lib/api/response';
import { withRoute } from '@/lib/api/withRoute';

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Öneriler getirilemedi' },
  async ({ request, user }) => {
    const sp = request.nextUrl.searchParams;
    const marketplaceId = sp.get('marketplaceId');
    const productionMonth = sp.get('productionMonth');
    const status = sp.get('status');
    const category = sp.get('category');
    const q = sp.get('q');

    const where: Prisma.ProductionSuggestionWhereInput = {};
    if (marketplaceId) where.marketplaceId = marketplaceId;
    if (productionMonth) where.productionMonth = productionMonth;
    if (status) where.status = status as Prisma.EnumSuggestionStatusFilter['equals'];
    if (category) where.productCategory = category;
    if (q) {
      where.OR = [
        { iwasku: { contains: q, mode: 'insensitive' } },
        { productName: { contains: q, mode: 'insensitive' } },
      ];
    }

    // Marketplace yetki filtresi (ADMIN/super-admin bypass)
    const userIsSuperAdmin = isSuperAdmin(user!.email);
    if (!userIsSuperAdmin && user!.role !== 'admin') {
      const perms = await prisma.userMarketplacePermission.findMany({
        where: { userId: user!.id, canView: true },
        select: { marketplaceId: true },
      });
      const allowed = perms.map(p => p.marketplaceId);
      if (allowed.length === 0) {
        return successResponse({ suggestions: [], total: 0 });
      }
      if (marketplaceId) {
        if (!allowed.includes(marketplaceId)) {
          return successResponse({ suggestions: [], total: 0 });
        }
        // marketplaceId zaten where'de set, izinli — değişiklik yok
      } else {
        where.marketplaceId = { in: allowed };
      }
    }

    const [suggestions, total] = await Promise.all([
      prisma.productionSuggestion.findMany({
        where,
        include: { marketplace: { select: { id: true, name: true, code: true, region: true } } },
        orderBy: [{ status: 'asc' }, { suggestedQty: 'desc' }],
        take: 1000,
      }),
      prisma.productionSuggestion.count({ where }),
    ]);

    return successResponse({ suggestions, total });
  },
);
