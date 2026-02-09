/**
 * Marketplaces API
 * GET: List all active marketplaces
 * POST: Create new custom marketplace
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  try {
    const marketplaces = await prisma.marketplace.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return NextResponse.json({
      success: true,
      data: marketplaces,
    });
  } catch (error) {
    console.error('Fetch marketplaces error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch marketplaces',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, region, marketplaceType } = body;

    // Validation
    if (!name || !region) {
      return NextResponse.json(
        { error: 'Name and region are required' },
        { status: 400 }
      );
    }

    // Get admin user
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });

    if (!adminUser) {
      return NextResponse.json(
        { error: 'No admin user found' },
        { status: 500 }
      );
    }

    // Generate unique code for custom marketplace
    const existingCustom = await prisma.marketplace.findMany({
      where: {
        code: {
          startsWith: 'CUSTOM_',
        },
      },
    });

    const nextNumber = existingCustom.length + 1;
    const code = `CUSTOM_${String(nextNumber).padStart(2, '0')}`;

    // Create marketplace
    const marketplace = await prisma.marketplace.create({
      data: {
        name,
        code,
        region,
        marketplaceType: marketplaceType || 'CUSTOM',
        isCustom: true,
        isActive: true,
        createdById: adminUser.id,
      },
    });

    return NextResponse.json({
      success: true,
      data: marketplace,
    });
  } catch (error) {
    console.error('Create marketplace error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create marketplace',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
