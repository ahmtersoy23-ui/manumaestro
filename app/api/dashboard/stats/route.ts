/**
 * Dashboard Stats API
 * GET: Returns aggregated stats for multiple production months in a single query
 * Replaces N+1 calls to /api/requests/monthly from the dashboard page
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { errorResponse } from '@/lib/api/response';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { verifyAuth } from '@/lib/auth/verify';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting: 200 requests per minute for read operations
    const rateLimitResult = await rateLimiters.read.check(request, 'dashboard-stats');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication: Require any authenticated user
    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const monthsParam = searchParams.get('months');

    if (!monthsParam) {
      return NextResponse.json(
        { success: false, error: 'months parametresi gereklidir (virgülle ayrılmış YYYY-MM değerleri)' },
        { status: 400 }
      );
    }

    // Validate and parse months
    const monthRegex = /^\d{4}-\d{2}$/;
    const months = monthsParam.split(',').filter(m => monthRegex.test(m.trim())).map(m => m.trim());

    if (months.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Geçerli ay bulunamadı. Beklenen format: YYYY-MM' },
        { status: 400 }
      );
    }

    // Cap to prevent abuse
    if (months.length > 24) {
      return NextResponse.json(
        { success: false, error: 'İstek başına en fazla 24 ay izin verilir' },
        { status: 400 }
      );
    }

    // Single query: fetch all requests for all requested months at once
    const requests = await prisma.productionRequest.findMany({
      where: {
        productionMonth: { in: months },
      },
      select: {
        iwasku: true,
        productCategory: true,
        productSize: true,
        quantity: true,
        producedQuantity: true,
        productionMonth: true,
      },
    });

    // Build stats per month in memory (avoiding N separate DB round trips)
    const statsMap = new Map<string, {
      totalRequests: number;
      totalQuantity: number;
      totalDesi: number;
      itemsWithoutSize: number;
      // Track unique products per month for produced calculation
      productMap: Map<string, { producedQty: number; productSize: number }>;
    }>();

    // Initialize all requested months (so months with 0 requests still appear)
    for (const month of months) {
      statsMap.set(month, {
        totalRequests: 0,
        totalQuantity: 0,
        totalDesi: 0,
        itemsWithoutSize: 0,
        productMap: new Map(),
      });
    }

    // Get MonthSnapshot.produced for all months (single source of truth)
    const allSnapshots = await prisma.monthSnapshot.findMany({
      where: { month: { in: months } },
      select: { month: true, iwasku: true, produced: true },
    });
    const snapshotProducedMap = new Map<string, number>(); // "month|iwasku" → produced
    for (const s of allSnapshots) {
      snapshotProducedMap.set(`${s.month}|${s.iwasku}`, s.produced);
    }

    // Aggregate in a single pass over the result set
    for (const r of requests) {
      const entry = statsMap.get(r.productionMonth)!;
      entry.totalRequests += 1;
      entry.totalQuantity += r.quantity;
      entry.totalDesi += (r.productSize || 0) * r.quantity;
      if (!r.productSize) {
        entry.itemsWithoutSize += 1;
      }

      // Track unique products — produced from MonthSnapshot
      const existing = entry.productMap.get(r.iwasku);
      if (!existing) {
        entry.productMap.set(r.iwasku, {
          producedQty: snapshotProducedMap.get(`${r.productionMonth}|${r.iwasku}`) ?? 0,
          productSize: r.productSize || 0,
        });
      }
    }

    // Build the response
    const result = months.map(month => {
      const entry = statsMap.get(month)!;

      // Sum produced from unique products only
      let totalProduced = 0;
      let totalProducedDesi = 0;
      for (const product of entry.productMap.values()) {
        totalProduced += product.producedQty;
        totalProducedDesi += product.productSize * product.producedQty;
      }

      return {
        month,
        totalRequests: entry.totalRequests,
        totalQuantity: entry.totalQuantity,
        totalProduced,
        totalDesi: entry.totalDesi,
        totalProducedDesi,
        itemsWithoutSize: entry.itemsWithoutSize,
      };
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return errorResponse(error, 'Panel istatistikleri getirilemedi');
  }
}
