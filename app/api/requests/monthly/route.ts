/**
 * Monthly Requests Stats API
 * GET: Returns total requests and quantities for a specific production month
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { enrichProductSize } from '@/lib/db/enrichProductSize';
import { successResponse, errorResponse } from '@/lib/api/response';
import { ValidationError } from '@/lib/api/errors';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { verifyAuth } from '@/lib/auth/verify';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting: 200 requests per minute for read operations
    const rateLimitResult = await rateLimiters.read.check(request, 'monthly-stats');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication: Require any authenticated user
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      throw new ValidationError('Ay parametresi gereklidir');
    }

    // Validate month format (YYYY-MM)
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      throw new ValidationError('Geçersiz ay formatı. Beklenen: YYYY-MM');
    }

    // Optional status filter (comma-separated)
    const statusParam = searchParams.get('statuses');
    const statusFilter = statusParam
      ? statusParam.split(',').filter(Boolean)
      : undefined;

    // Optional marketplace filter
    const marketplaceParam = searchParams.get('marketplace');

    // Single query: fetch all request data needed for both stats and summary
    const requests = await prisma.productionRequest.findMany({
      where: {
        productionMonth: month,
        ...(statusFilter && { status: { in: statusFilter as never[] } }),
        ...(marketplaceParam && { marketplaceId: marketplaceParam }),
      },
      select: {
        iwasku: true,
        productName: true,
        productCategory: true,
        productSize: true,
        quantity: true,
        producedQuantity: true,
        status: true,
        marketplace: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Enrich productSize from pricelab_db (tek kaynak)
    await enrichProductSize(requests);

    // Compute aggregate stats in memory from the single query result
    const stats = {
      _count: { id: requests.length },
      _sum: {
        quantity: requests.reduce((sum, r) => sum + r.quantity, 0),
        producedQuantity: requests.reduce((sum, r) => sum + (r.producedQuantity || 0), 0),
      },
    };

    // Get MonthSnapshot.produced (single source of truth for production)
    const iwaskuList = [...new Set(requests.map(r => r.iwasku))];
    const snapshots = iwaskuList.length > 0
      ? await prisma.monthSnapshot.findMany({
          where: { month, iwasku: { in: iwaskuList } },
          select: { iwasku: true, produced: true },
        })
      : [];
    const producedMap = new Map(snapshots.map(s => [s.iwasku, s.produced]));

    // Group by IWASKU
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productMap = new Map<string, any>();
    requests.forEach((request) => {
      const existing = productMap.get(request.iwasku);

      if (existing) {
        existing.totalRequestedQty += request.quantity;
        existing.requests.push(request);
      } else {
        productMap.set(request.iwasku, {
          iwasku: request.iwasku,
          productCategory: request.productCategory,
          productSize: request.productSize,
          producedQty: producedMap.get(request.iwasku) ?? 0,
          totalRequestedQty: request.quantity,
          requests: [request],
        });
      }
    });

    // Group by category only (simplified - marketplace is just metadata)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const categoryMap = new Map<string, any>();

    requests.forEach((request) => {
      const existing = categoryMap.get(request.productCategory);
      const desiPerUnit = request.productSize || 0;
      const requestTotalDesi = desiPerUnit * request.quantity;

      if (existing) {
        existing.totalQuantity += request.quantity;
        existing.totalDesi += requestTotalDesi;
        existing.requestCount += 1;
        existing.itemsWithoutSize += request.productSize ? 0 : 1;
        // Track unique marketplaces as metadata
        if (!existing.marketplaces.includes(request.marketplace.name)) {
          existing.marketplaces.push(request.marketplace.name);
        }
      } else {
        categoryMap.set(request.productCategory, {
          productCategory: request.productCategory,
          totalQuantity: request.quantity,
          totalDesi: requestTotalDesi,
          requestCount: 1,
          itemsWithoutSize: request.productSize ? 0 : 1,
          marketplaces: [request.marketplace.name],
        });
      }
    });

    // Add production totals from productMap (by category)
    const summary = Array.from(categoryMap.values()).map(category => {
      // Calculate total produced for this category from all products in that category
      const categoryProducts = Array.from(productMap.values()).filter(
        p => p.productCategory === category.productCategory
      );

      const totalProduced = categoryProducts.reduce((sum, p) => sum + p.producedQty, 0);
      const producedDesi = categoryProducts.reduce(
        (sum, p) => sum + ((p.productSize || 0) * p.producedQty),
        0
      );

      return {
        ...category,
        totalProduced,
        producedDesi,
      };
    });

    // Create marketplace summary (for marketplace cards)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const marketplaceMap = new Map<string, any>();
    requests.forEach((request) => {
      const existing = marketplaceMap.get(request.marketplace.id);
      const requestTotalDesi = (request.productSize || 0) * request.quantity;

      const isCompleted = request.status === 'COMPLETED';
      if (existing) {
        existing.totalQuantity += request.quantity;
        existing.totalDesi += requestTotalDesi;
        existing.requestCount += 1;
        if (isCompleted) { existing.completedCount += 1; existing.completedQty += request.quantity; existing.completedDesi += requestTotalDesi; }
      } else {
        marketplaceMap.set(request.marketplace.id, {
          marketplaceId: request.marketplace.id,
          marketplaceName: request.marketplace.name,
          totalQuantity: request.quantity,
          totalDesi: requestTotalDesi,
          requestCount: 1,
          completedCount: isCompleted ? 1 : 0,
          completedQty: isCompleted ? request.quantity : 0,
          completedDesi: isCompleted ? requestTotalDesi : 0,
        });
      }
    });

    const marketplaceSummary = Array.from(marketplaceMap.values());

    // Calculate total desi (sum across all requests)
    const totalDesi = requests.reduce((sum, r) => sum + ((r.productSize || 0) * r.quantity), 0);

    // Calculate total produced (sum unique products only, not requests)
    const totalProduced = Array.from(productMap.values()).reduce(
      (sum, product) => sum + product.producedQty,
      0
    );

    // Calculate total produced desi (sum unique products only, not requests)
    const totalProducedDesi = Array.from(productMap.values()).reduce(
      (sum, product) => sum + ((product.productSize || 0) * product.producedQty),
      0
    );

    // Debug info now in response meta

    const itemsWithoutSize = requests.filter(r => !r.productSize).length;

    // Get details of items without size
    const missingDesiItems = requests
      .filter(r => !r.productSize)
      .map(r => ({
        productName: r.productName,
        productCategory: r.productCategory,
      }));

    // Per-IWASKU summary for live demand (used with snapshot stock)
    const iwaskuSummary = Array.from(productMap.values()).map(p => ({
      iwasku: p.iwasku,
      category: p.productCategory,
      totalQty: p.totalRequestedQty,
      desi: p.productSize || 0,
    }));

    return successResponse(
      {
        totalRequests: stats._count.id || 0,
        totalQuantity: stats._sum.quantity || 0,
        totalProduced,
        totalDesi,
        totalProducedDesi,
        itemsWithoutSize,
        missingDesiItems,
        summary,
        marketplaceSummary,
        iwaskuSummary,
      },
      {
        debug: {
          aggregateSum: stats._sum.producedQuantity,
          calculatedTotal: totalProduced,
          uniqueProducts: productMap.size,
          month,
        },
      }
    );
  } catch (error) {
    return errorResponse(error, 'Aylık istatistikler getirilemedi');
  }
}
