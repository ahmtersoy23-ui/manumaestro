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

    // Parse month (format: YYYY-MM)
    const [year, monthNum] = month.split('-').map(Number);

    if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
      return NextResponse.json(
        { error: 'Invalid month format. Expected YYYY-MM' },
        { status: 400 }
      );
    }

    // Create date range for the month
    const startDate = new Date(year, monthNum - 1, 1); // First day of month
    const endDate = new Date(year, monthNum, 1); // First day of next month

    // Query stats for the month
    const stats = await prisma.productionRequest.aggregate({
      where: {
        requestDate: {
          gte: startDate,
          lt: endDate,
        },
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
        requestDate: {
          gte: startDate,
          lt: endDate,
        },
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

    // Group by category and marketplace
    const summary = requests.reduce((acc: any[], request) => {
      const existing = acc.find(
        item =>
          item.productCategory === request.productCategory &&
          item.marketplaceId === request.marketplaceId
      );

      const desiPerUnit = request.productSize || 0;
      const requestTotalDesi = desiPerUnit * request.quantity;
      const producedTotalDesi = desiPerUnit * (request.producedQuantity || 0);

      if (existing) {
        existing.totalQuantity += request.quantity;
        existing.totalProduced += request.producedQuantity || 0;
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
          totalProduced: request.producedQuantity || 0,
          totalDesi: requestTotalDesi,
          producedDesi: producedTotalDesi,
          requestCount: 1,
          itemsWithoutSize: request.productSize ? 0 : 1,
        });
      }

      return acc;
    }, []);

    // Calculate total desi
    const totalDesi = requests.reduce((sum, r) => sum + ((r.productSize || 0) * r.quantity), 0);
    const totalProducedDesi = requests.reduce((sum, r) => sum + ((r.productSize || 0) * (r.producedQuantity || 0)), 0);
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
        totalProduced: stats._sum.producedQuantity || 0,
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
