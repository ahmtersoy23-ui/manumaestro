/**
 * Get Requests by Category API
 * Fetches production requests for a specific category and month
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { formatMonthValue } from '@/lib/monthUtils';
import { verifyAuth } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  try {
    // Rate limiting: 200 requests per minute for read operations
    const rateLimitResult = await rateLimiters.read.check(request, 'category-requests');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication: Require any authenticated user
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { category } = await params;
    const searchParams = request.nextUrl.searchParams;
    const monthParam = searchParams.get('month');

    // Pagination parameters
    const rawPage = parseInt(searchParams.get('page') || '1');
    const rawLimit = parseInt(searchParams.get('limit') || '50');
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 1), 200);
    const skip = (page - 1) * limit;

    if (!category) {
      return NextResponse.json(
        { error: 'Category is required' },
        { status: 400 }
      );
    }

    // Default to current month if not provided
    const productionMonth = monthParam || formatMonthValue(new Date());

    const where = {
      productCategory: decodeURIComponent(category),
      productionMonth,
    };

    // Fetch requests for this category and production month
    const [requests, total] = await Promise.all([
      prisma.productionRequest.findMany({
        where,
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
        skip,
        take: limit,
      }),
      prisma.productionRequest.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    const formattedRequests = requests.map((r: any) => ({
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
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch requests');
  }
}
