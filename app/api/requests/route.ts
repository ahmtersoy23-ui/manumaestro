/**
 * Production Requests API
 * POST: Create new request
 * GET: List requests with filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma, EntryType, RequestStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { enrichProductSize } from '@/lib/db/enrichProductSize';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { verifyAuth, requireSuperAdmin, checkMarketplacePermission } from '@/lib/auth/verify';
import { ProductionRequestSchema, formatValidationError } from '@/lib/validation/schemas';
import { errorResponse } from '@/lib/api/response';
import { logAction } from '@/lib/auditLog';

export async function POST(request: NextRequest) {
  try {
    // Rate limiting: 100 requests per minute for write operations
    const rateLimitResult = await rateLimiters.write.check(request, 'create-request');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authorization: Süper-admin gerekli (yeni talep girişi kritik aksiyon)
    const authResult = await requireSuperAdmin(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    const body = await request.json();

    // Zod validation
    const validation = ProductionRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Doğrulama hatası',
          details: formatValidationError(validation.error),
        },
        { status: 400 }
      );
    }

    const { iwasku, productName, productCategory, productSize, marketplaceId, quantity, productionMonth, notes, priority } = validation.data;

    // Marketplace permission check for OPERATOR users
    const permCheck = await checkMarketplacePermission(user.id, user.role, marketplaceId, 'edit');
    if (!permCheck.allowed) {
      return NextResponse.json(
        { success: false, error: permCheck.reason || 'Bu pazar yerine talep oluşturamazsınız' },
        { status: 403 }
      );
    }

    // requestDate is always today (entry date)
    const requestDate = new Date();

    // Create production request
    const productionRequest = await prisma.productionRequest.create({
      data: {
        iwasku,
        productName,
        productCategory,
        productSize: productSize ?? null,
        marketplaceId,
        quantity,
        requestDate,
        productionMonth, // YYYY-MM format (e.g., "2026-03")
        notes: notes ?? null,
        priority: priority ?? 'MEDIUM',
        entryType: EntryType.MANUAL,
        status: RequestStatus.REQUESTED,
        enteredById: user.id, // Real authenticated user
      },
      include: {
        marketplace: true,
      },
    });

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'CREATE_REQUEST',
      entityType: 'ProductionRequest',
      entityId: productionRequest.id,
      description: `Talep oluşturuldu: ${iwasku} — ${productName} (${quantity} adet, ${productionMonth})`,
      metadata: { iwasku, productName, productCategory, quantity, productionMonth, priority, marketplaceId },
    });

    return NextResponse.json({
      success: true,
      data: productionRequest,
      warning: !productSize ? `${iwasku} ürününde desi verisi eksik. Lütfen PriceLab'den güncelleyin.` : undefined,
    });
  } catch (error) {
    return errorResponse(error, 'Talep oluşturulamadı');
  }
}

export async function GET(request: NextRequest) {
  try {
    // Rate limiting: 200 requests per minute for read operations
    const rateLimitResult = await rateLimiters.read.check(request, 'list-requests');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication: Require any authenticated user (viewer, editor, or admin)
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const marketplaceId = searchParams.get('marketplaceId');
    const status = searchParams.get('status');
    const month = searchParams.get('month'); // YYYY-MM format
    const archiveMode = searchParams.get('archiveMode') === 'true';

    // Pagination parameters
    const rawPage = parseInt(searchParams.get('page') || '1');
    const rawLimit = parseInt(searchParams.get('limit') || '50');
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 1), 200);
    const skip = (page - 1) * limit;

    const where: Prisma.ProductionRequestWhereInput = {};

    if (marketplaceId) {
      where.marketplaceId = marketplaceId;
    }

    if (status) {
      where.status = status as RequestStatus;
    }

    // Filter by productionMonth (not requestDate)
    if (month && !archiveMode) {
      // Filter by specific production month (YYYY-MM)
      where.productionMonth = month;
    } else if (archiveMode) {
      // Archive: All months before active months
      // Get all months that are older than the active months
      const today = new Date();
      const dayOfMonth = today.getDate();

      // Calculate the oldest active month
      const oldestActiveMonthOffset = dayOfMonth < 5 ? -2 : -1;
      const oldestActiveDate = new Date(today.getFullYear(), today.getMonth() + oldestActiveMonthOffset, 1);
      const oldestActiveMonth = `${oldestActiveDate.getFullYear()}-${String(oldestActiveDate.getMonth() + 1).padStart(2, '0')}`;

      where.productionMonth = {
        lt: oldestActiveMonth,
      };
    } else {
      // No filter - show all (will be handled by frontend month tabs)
      // This case shouldn't happen in normal usage
    }

    const [requests, total] = await Promise.all([
      prisma.productionRequest.findMany({
        where,
        include: {
          marketplace: true,
          enteredBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.productionRequest.count({ where }),
    ]);

    // COMPLETED request'ler için routing bilgisini ekle
    const completedIds = requests
      .filter(r => r.status === 'COMPLETED')
      .map(r => r.id);

    const routedItems = completedIds.length > 0
      ? await prisma.shipmentItem.findMany({
          where: { productionRequestId: { in: completedIds } },
          select: {
            productionRequestId: true,
            shipment: { select: { id: true, name: true } },
          },
        })
      : [];

    const routedMap = new Map(
      routedItems.map(i => [i.productionRequestId, i.shipment])
    );

    // Enrich productSize from pricelab_db (tek kaynak)
    await enrichProductSize(requests);

    const enrichedRequests = requests.map(r => ({
      ...r,
      routedShipment: r.status === 'COMPLETED' ? routedMap.get(r.id) ?? null : null,
    }));

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      data: enrichedRequests,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Talepler getirilemedi');
  }
}
