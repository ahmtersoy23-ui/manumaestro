/**
 * Get Requests by Category API
 * Fetches production requests for a specific category and month
 * Groups by IWASKU, paginated by unique product count, sorted A-Z
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { enrichProductSize } from '@/lib/db/enrichProductSize';
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

    // 4. Enrich productSize from pricelab_db (tek kaynak)
    await enrichProductSize(requests);

    // 5. Snapshot stock (fixed) — sayfa IWASKU'ları için
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

    // 6. Tüm kategori summary (sayfalamadan bağımsız)
    const allRequests = await prisma.productionRequest.findMany({
      where: {
        ...baseWhere,
        ...(statusFilter && { status: { in: statusFilter as never[] } }),
        ...(marketplaceParam && { marketplaceId: marketplaceParam }),
      },
      select: { iwasku: true, quantity: true, productSize: true },
    });
    await enrichProductSize(allRequests);

    const allSnapshots = await prisma.monthSnapshot.findMany({
      where: { month: productionMonth, iwasku: { in: [...new Set(allRequests.map(r => r.iwasku))] } },
    });
    const allStockMap = new Map<string, number>();
    const allProducedMap = new Map<string, number>();
    for (const s of allSnapshots) {
      allStockMap.set(s.iwasku, s.warehouseStock);
      allProducedMap.set(s.iwasku, s.produced);
    }

    // IWASKU bazlı gruplama + aggregate
    const summaryMap = new Map<string, { totalQty: number; desi: number; stock: number; produced: number }>();
    for (const r of allRequests) {
      const existing = summaryMap.get(r.iwasku);
      if (existing) {
        existing.totalQty += r.quantity;
      } else {
        summaryMap.set(r.iwasku, {
          totalQty: r.quantity,
          desi: r.productSize ?? 0,
          stock: allStockMap.get(r.iwasku) ?? 0,
          produced: allProducedMap.get(r.iwasku) ?? 0,
        });
      }
    }

    let talep = 0, talepDesi = 0, stok = 0, stokDesi = 0;
    let netIhtiyac = 0, netDesi = 0, uretilen = 0, uretilenDesi = 0;
    let kalan = 0, kalanDesi = 0;
    for (const [, v] of summaryMap) {
      const net = Math.max(0, v.totalQty - v.stock);
      const rem = Math.max(0, net - v.produced);
      talep += v.totalQty;
      talepDesi += v.totalQty * v.desi;
      stok += v.stock;
      stokDesi += v.stock * v.desi;
      netIhtiyac += net;
      netDesi += net * v.desi;
      uretilen += v.produced;
      uretilenDesi += v.produced * v.desi;
      kalan += rem;
      kalanDesi += rem * v.desi;
    }
    const summary = {
      talep, talepDesi: Math.round(talepDesi),
      stok, stokDesi: Math.round(stokDesi),
      netIhtiyac, netDesi: Math.round(netDesi),
      uretilen, uretilenDesi: Math.round(uretilenDesi),
      kalan, kalanDesi: Math.round(kalanDesi),
      pct: netIhtiyac > 0 ? Math.round((uretilen / netIhtiyac) * 100) : 0,
    };

    // 7. Format
    const formattedRequests = requests.map((r) => ({
      id: r.id,
      iwasku: r.iwasku,
      productName: r.productName,
      productCategory: r.productCategory,
      productSize: r.productSize ?? null,
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
      summary,
      availableMarketplaces,
    });
  } catch (error) {
    return errorResponse(error, 'Talepler getirilemedi');
  }
}
