/**
 * Get Requests by Category API
 * Fetches production requests for a specific category and month
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { parseMonthValue } from '@/lib/monthUtils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  try {
    const { category } = await params;
    const searchParams = request.nextUrl.searchParams;
    const monthParam = searchParams.get('month');

    if (!category) {
      return NextResponse.json(
        { error: 'Category is required' },
        { status: 400 }
      );
    }

    // Parse month and get start/end dates
    let startDate: Date;
    let endDate: Date;

    if (monthParam) {
      const monthDate = parseMonthValue(monthParam);
      startDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      endDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59);
    } else {
      // Default to current month
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }

    // Fetch requests for this category and month
    const requests = await prisma.productionRequest.findMany({
      where: {
        productCategory: decodeURIComponent(category),
        requestDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        marketplace: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        requestDate: 'desc',
      },
    });

    const formattedRequests = requests.map((r) => ({
      id: r.id,
      iwasku: r.iwasku,
      productName: r.productName,
      productCategory: r.productCategory,
      marketplaceName: r.marketplace.name,
      quantity: r.quantity,
      producedQuantity: r.producedQuantity,
      manufacturerNotes: r.manufacturerNotes,
      workflowStage: r.workflowStage,
      status: r.status,
      requestDate: r.requestDate.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      data: formattedRequests,
    });
  } catch (error) {
    console.error('Category requests fetch error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch requests',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
