/**
 * Production Requests API
 * POST: Create new request
 * GET: List requests with filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { EntryType, RequestStatus } from '@prisma/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { iwasku, productName, productCategory, marketplaceId, quantity, productionMonth, notes } = body;

    // Validation
    if (!iwasku || !productName || !productCategory || !marketplaceId || !quantity) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Parse production month to set request date
    let requestDate = new Date();
    if (productionMonth) {
      const [year, month] = productionMonth.split('-').map(Number);
      requestDate = new Date(year, month - 1, 1); // First day of the month
    }

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
        marketplaceId,
        quantity: parseInt(quantity),
        requestDate,
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
    });
  } catch (error) {
    console.error('Create request error:', error);
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
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: any = {};

    if (marketplaceId) {
      where.marketplaceId = marketplaceId;
    }

    if (status) {
      where.status = status as RequestStatus;
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
    console.error('Fetch requests error:', error);
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
