/**
 * Monthly Requests Stats API
 * GET: Returns total requests and quantities for a specific production month
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      return NextResponse.json(
        { error: 'Month parameter is required' },
        { status: 400 }
      );
    }

    // Validate month format (YYYY-MM)
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      return NextResponse.json(
        { error: 'Invalid month format. Expected YYYY-MM' },
        { status: 400 }
      );
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

    // Now group by category and marketplace for summary
    // Production quantities are distributed proportionally based on each marketplace's request
    const summary = requests.reduce((acc: any[], request) => {
      const existing = acc.find(
        item =>
          item.productCategory === request.productCategory &&
          item.marketplaceId === request.marketplaceId
      );

      const productData = productMap.get(request.iwasku);
      const desiPerUnit = request.productSize || 0;
      const requestTotalDesi = desiPerUnit * request.quantity;

      // Distribute produced quantity proportionally
      // If this marketplace requested 50 out of 150 total for this product,
      // and 120 were produced, this marketplace gets (50/150) * 120 = 40
      const productionRatio = productData.totalRequestedQty > 0
        ? request.quantity / productData.totalRequestedQty
        : 0;
      const producedForThisRequest = productData.producedQty * productionRatio;
      const producedTotalDesi = desiPerUnit * producedForThisRequest;

      if (existing) {
        existing.totalQuantity += request.quantity;
        existing.totalProduced += producedForThisRequest;
        existing.totalDesi += requestTotalDesi;
        existing.producedDesi += producedTotalDesi;
        existing.requestCount += 1;
        existing.itemsWithoutSize += request.productSize ? 0 : 1;
      } else {
        acc.push({
          productCategory: request.productCategory,
          marketplaceId: request.marketplaceId,
          marketplaceName: request.marketplace.name,
          totalQuantity: request.quantity,
          totalProduced: producedForThisRequest,
          totalDesi: requestTotalDesi,
          producedDesi: producedTotalDesi,
          requestCount: 1,
          itemsWithoutSize: request.productSize ? 0 : 1,
        });
      }

      return acc;
    }, []);

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

    const itemsWithoutSize = requests.filter(r => !r.productSize).length;

    // Get details of items without size
    const missingDesiItems = requests
      .filter(r => !r.productSize)
      .map(r => ({
        productName: r.productName,
        productCategory: r.productCategory,
      }));

    return NextResponse.json({
      success: true,
      data: {
        totalRequests: stats._count.id || 0,
        totalQuantity: stats._sum.quantity || 0,
        totalProduced, // Use calculated value from unique products
        totalDesi,
        totalProducedDesi,
        itemsWithoutSize,
        missingDesiItems,
        summary,
      },
    });
  } catch (error) {
    console.error('Monthly stats error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch monthly statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
