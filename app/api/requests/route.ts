/**
 * Production Requests API
 * POST: Create new request
 * GET: List requests with filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { EntryType, RequestStatus } from '@prisma/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('Requests API');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { iwasku, productName, productCategory, productSize, marketplaceId, quantity, productionMonth, notes } = body;

    // Validation
    if (!iwasku || !productName || !productCategory || !marketplaceId || !quantity || !productionMonth) {
      return NextResponse.json(
        { error: 'Missing required fields (iwasku, productName, productCategory, marketplaceId, quantity, productionMonth)' },
        { status: 400 }
      );
    }

    // requestDate is always today (entry date)
    const requestDate = new Date();

    // TODO: Get actual user ID from session/SSO
    // For now, get the admin user
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });

    if (!adminUser) {
      return NextResponse.json(
        { error: 'No admin user found. Please run database seed.' },
        { status: 500 }
      );
    }

    // Create production request
    const productionRequest = await prisma.productionRequest.create({
      data: {
        iwasku,
        productName,
        productCategory,
        productSize: productSize ? parseFloat(productSize) : null,
        marketplaceId,
        quantity: parseInt(quantity),
        requestDate,
        productionMonth, // YYYY-MM format (e.g., "2026-03")
        notes,
        entryType: EntryType.MANUAL,
        status: RequestStatus.REQUESTED,
        enteredById: adminUser.id,
      },
      include: {
        marketplace: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: productionRequest,
      warning: !productSize ? `Product ${iwasku} is missing desi (size) data. Please update in PriceLab.` : undefined,
    });
  } catch (error) {
    logger.error('Create request error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create request',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const marketplaceId = searchParams.get('marketplaceId');
    const status = searchParams.get('status');
    const month = searchParams.get('month'); // YYYY-MM format
    const archiveMode = searchParams.get('archiveMode') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: any = {};

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

    const requests = await prisma.productionRequest.findMany({
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
      take: limit,
    });

    return NextResponse.json({
      success: true,
      data: requests,
      count: requests.length,
    });
  } catch (error) {
    logger.error('Fetch requests error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch requests',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
