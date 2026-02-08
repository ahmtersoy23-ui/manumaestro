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
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        totalRequests: stats._count.id || 0,
        totalQuantity: stats._sum.quantity || 0,
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
