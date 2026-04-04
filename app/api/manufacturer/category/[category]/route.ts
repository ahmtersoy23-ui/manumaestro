/**
 * Get Requests by Category API
 * Fetches production requests for a specific category and month
 * Groups by IWASKU, paginated by unique product count, sorted A-Z
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
    const rateLimitResult = await rateLimiters.read.check(request, 'category-requests');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const { category } = await params;
    const searchParams = request.nextUrl.searchParams;
    const monthParam = searchParams.get('month');
    const searchQuery = searchParams.get('search')?.trim() || '';

    const rawPage = parseInt(searchParams.get('page') || '1');
    const rawLimit = parseInt(searchParams.get('limit') || '30');
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 1), 200);

    if (!category) {
      return NextResponse.json({ error: 'Kategori gereklidir' }, { status: 400 });
    }

    const productionMonth = monthParam || formatMonthValue(new Date());
    const decodedCategory = decodeURIComponent(category);

    // Optional filters
    const statusParam = searchParams.get('statuses');
    const statusFilter = statusParam ? statusParam.split(',').filter(Boolean) : undefined;
    const marketplaceParam = searchParams.get('marketplace');

    // Base where for all queries (category + month)
    const baseWhere = { productCategory: decodedCategory, productionMonth };

    // Filtered where (includes status/marketplace)
    const filteredWhere = {
      ...baseWhere,
      ...(statusFilter && { status: { in: statusFilter as never[] } }),
      ...(marketplaceParam && { marketplaceId: marketplaceParam }),
      ...(searchQuery && {
        OR: [
          { iwasku: { contains: searchQuery, mode: 'insensitive' as const } },
          { productName: { contains: searchQuery, mode: 'insensitive' as const } },
        ],
      }),
    };

    // 1. Get distinct IWASKUs sorted A-Z (with filters + search)
    const distinctProducts = await prisma.productionRequest.findMany({
      where: filteredWhere,
      select: { iwasku: true },
      distinct: ['iwasku'],
      orderBy: { iwasku: 'asc' },
    });

    const allIwaskus = distinctProducts.map(r => r.iwasku);
    const totalProducts = allIwaskus.length;
    const totalPages = Math.ceil(totalProducts / limit);

    // 2. Page slice of IWASKUs
    const pageIwaskus = allIwaskus.slice((page - 1) * limit, page * limit);

    // 3. Fetch ALL requests for the page's IWASKUs (no skip/take — need all for grouping)
    const requests = pageIwaskus.length > 0
      ? await prisma.productionRequest.findMany({
          where: {
            ...filteredWhere,
            iwasku: { in: pageIwaskus },
          },
          include: {
            marketplace: { select: { name: true, colorTag: true } },
          },
          orderBy: { iwasku: 'asc' },
        })
      : [];

    // 4. Snapshot stock (fixed)
    const snapshots = pageIwaskus.length > 0
      ? await prisma.monthSnapshot.findMany({
          where: { month: productionMonth, iwasku: { in: pageIwaskus } },
        })
      : [];
    const stockMap = new Map<string, number>();
    const producedMap = new Map<string, number>();
    for (const s of snapshots) {
      stockMap.set(s.iwasku, s.warehouseStock);
      producedMap.set(s.iwasku, s.produced);
    }

    // 5. Format
    const formattedRequests = requests.map((r) => ({
      id: r.id,
      iwasku: r.iwasku,
      productName: r.productName,
      productCategory: r.productCategory,
      marketplaceName: r.marketplace.name,
      marketplaceColorTag: r.marketplace.colorTag,
      quantity: r.quantity,
      producedQuantity: producedMap.get(r.iwasku) ?? r.producedQuantity ?? 0,
      manufacturerNotes: r.manufacturerNotes,
      status: r.status,
      priority: r.priority,
      requestDate: r.requestDate.toISOString(),
      warehouseStock: stockMap.get(r.iwasku) ?? null,
    }));

    // 6. Available marketplaces (unfiltered, for filter UI)
    const distinctMarketplaces = await prisma.productionRequest.findMany({
      where: baseWhere,
      select: { marketplace: { select: { id: true, name: true } } },
      distinct: ['marketplaceId'],
    });
    const availableMarketplaces = distinctMarketplaces.map(r => ({
      id: r.marketplace.id,
      name: r.marketplace.name,
    }));

    return NextResponse.json({
      success: true,
      data: formattedRequests,
      pagination: {
        page,
        limit,
        total: totalProducts,
        totalPages,
      },
      availableMarketplaces,
    });
  } catch (error) {
    return errorResponse(error, 'Talepler getirilemedi');
  }
}
