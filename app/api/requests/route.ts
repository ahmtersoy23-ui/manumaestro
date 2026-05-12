/**
 * Production Requests API
 * POST: Create new request
 * GET: List requests with filters
 */

import { NextResponse } from 'next/server';
import { Prisma, EntryType, RequestStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { enrichProductSize } from '@/lib/db/enrichProductSize';
import { checkMarketplacePermission, isSuperAdmin } from '@/lib/auth/verify';
import { ProductionRequestSchema, formatValidationError } from '@/lib/validation/schemas';
import { logAction } from '@/lib/auditLog';
import { revalidateTag } from 'next/cache';
import { isMonthLocked } from '@/lib/monthUtils';
import { withRoute } from '@/lib/api/withRoute';

export const POST = withRoute(
  { rateLimit: 'write', fallbackMessage: 'Talep oluşturulamadı' },
  async ({ request, user }) => {
    const body = await request.json();

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

    // Yetkilendirme: süper-admin değilse, kilitli ay yasak + marketplace edit izni gerekli
    const userIsSuperAdmin = isSuperAdmin(user!.email);
    if (!userIsSuperAdmin) {
      if (isMonthLocked(productionMonth)) {
        return NextResponse.json(
          { success: false, error: `${productionMonth} ayı kilitli. Bu ay için talep girişi süper-admin yetkisi gerektirir.` },
          { status: 403 }
        );
      }
      const permCheck = await checkMarketplacePermission(user!.id, user!.role, marketplaceId, 'edit');
      if (!permCheck.allowed) {
        return NextResponse.json(
          { success: false, error: permCheck.reason || 'Bu pazar yerine talep oluşturamazsınız' },
          { status: 403 }
        );
      }
    }

    // Upsert: ayni (iwasku, marketplace, productionMonth) varsa miktar + oncelik + notes guncelle
    const existingReq = await prisma.productionRequest.findFirst({
      where: { iwasku, marketplaceId, productionMonth },
      select: { id: true, quantity: true },
    });

    // requestDate is always today (entry date)
    const requestDate = new Date();

    let productionRequest;
    let wasUpdated = false;
    if (existingReq) {
      productionRequest = await prisma.productionRequest.update({
        where: { id: existingReq.id },
        data: {
          quantity,
          priority: priority ?? 'MEDIUM',
          notes: notes ?? null,
        },
        include: { marketplace: true },
      });
      wasUpdated = true;
    } else {
      productionRequest = await prisma.productionRequest.create({
        data: {
          iwasku,
          productName,
          productCategory,
          productSize: productSize ?? null,
          marketplaceId,
          quantity,
          requestDate,
          productionMonth,
          notes: notes ?? null,
          priority: priority ?? 'MEDIUM',
          entryType: EntryType.MANUAL,
          status: RequestStatus.REQUESTED,
          enteredById: user!.id,
        },
        include: { marketplace: true },
      });
    }

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: wasUpdated ? 'UPDATE_REQUEST' : 'CREATE_REQUEST',
      entityType: 'ProductionRequest',
      entityId: productionRequest.id,
      description: wasUpdated
        ? `Talep güncellendi: ${iwasku} — ${productName} (${existingReq!.quantity} → ${quantity} adet, ${productionMonth})`
        : `Talep oluşturuldu: ${iwasku} — ${productName} (${quantity} adet, ${productionMonth})`,
      metadata: { iwasku, productName, productCategory, quantity, productionMonth, priority, marketplaceId, updated: wasUpdated },
    });

    revalidateTag('dashboard-stats', 'default');

    return NextResponse.json({
      success: true,
      data: productionRequest,
      updated: wasUpdated,
      warning: !productSize ? `${iwasku} ürününde desi verisi eksik. Lütfen PriceLab'den güncelleyin.` : undefined,
    });
  }
);

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Talepler getirilemedi' },
  async ({ request }) => {
    const searchParams = request.nextUrl.searchParams;
    const marketplaceId = searchParams.get('marketplaceId');
    const status = searchParams.get('status');
    const month = searchParams.get('month'); // YYYY-MM format
    const archiveMode = searchParams.get('archiveMode') === 'true';

    // Pagination parameters
    const rawPage = parseInt(searchParams.get('page') || '1');
    const rawLimit = parseInt(searchParams.get('limit') || '50');
    const page = Math.max(rawPage, 1);
    // Cap 2000: aylik (marketplace, month) request kumelerinin hepsini summary
    // hesabi icin tek sayfada cekebilmek icin. SEZON Nisan 273 kayit; mevcut
    // tepe deger ~300, 2000 buyume payi. Asilirsa summary truncate olur.
    const limit = Math.min(Math.max(rawLimit, 1), 2000);
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
  }
);
