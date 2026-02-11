/**
 * Monthly Requests Stats API
 * GET: Returns total requests and quantities for a specific production month
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { successResponse, errorResponse } from '@/lib/api/response';
import { ValidationError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      throw new ValidationError('Month parameter is required');
    }

    // Validate month format (YYYY-MM)
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      throw new ValidationError('Invalid month format. Expected YYYY-MM');
    }

    // Query stats for the production month
    const stats = await prisma.productionRequest.aggregate({
      where: {
        productionMonth: month,
      },
      _count: {
        id: true,
      },
      _sum: {
        quantity: true,
        producedQuantity: true,
      },
    });

    // Query detailed summary grouped by category and marketplace
    const requests = await prisma.productionRequest.findMany({
      where: {
        productionMonth: month,
      },
      include: {
        marketplace: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // First, group by IWASKU to track production per product (not per request)
    const productMap = new Map<string, any>();
    requests.forEach((request) => {
      const existing = productMap.get(request.iwasku);

      if (existing) {
        // Sum requested quantities across all marketplace requests for this product
        existing.totalRequestedQty += request.quantity;
        existing.requests.push(request);
      } else {
        productMap.set(request.iwasku, {
          iwasku: request.iwasku,
          productCategory: request.productCategory,
          productSize: request.productSize,
          // Use the producedQuantity from the first request (they should all be the same for the same product)
          producedQty: request.producedQuantity || 0,
          totalRequestedQty: request.quantity,
          requests: [request],
        });
      }
    });

    // Group by category only (simplified - marketplace is just metadata)
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
    const marketplaceMap = new Map<string, any>();
    requests.forEach((request) => {
      const existing = marketplaceMap.get(request.marketplace.id);
      const requestTotalDesi = (request.productSize || 0) * request.quantity;

      if (existing) {
        existing.totalQuantity += request.quantity;
        existing.totalDesi += requestTotalDesi;
        existing.requestCount += 1;
      } else {
        marketplaceMap.set(request.marketplace.id, {
          marketplaceId: request.marketplace.id,
          marketplaceName: request.marketplace.name,
          totalQuantity: request.quantity,
          totalDesi: requestTotalDesi,
          requestCount: 1,
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

    return successResponse(
      {
        totalRequests: stats._count.id || 0,
        totalQuantity: stats._sum.quantity || 0,
        totalProduced, // Use calculated value from unique products
        totalDesi,
        totalProducedDesi,
        itemsWithoutSize,
        missingDesiItems,
        summary,
        marketplaceSummary,
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
    return errorResponse(error, 'Failed to fetch monthly statistics');
  }
}
