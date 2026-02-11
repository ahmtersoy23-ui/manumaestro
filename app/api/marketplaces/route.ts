/**
 * Marketplaces API
 * GET: List all active marketplaces
 * POST: Create new custom marketplace
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { logAction } from '@/lib/auditLog';
import { createLogger } from '@/lib/logger';
import { MarketplaceCreateSchema, formatValidationError } from '@/lib/validation/schemas';

const logger = createLogger('Marketplaces API');

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
    logger.error('Fetch marketplaces error:', error);
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

    // Validate with Zod
    const validation = MarketplaceCreateSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: formatValidationError(validation.error),
        },
        { status: 400 }
      );
    }

    const { name, region, marketplaceType } = validation.data;

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

    // Log action
    await logAction({
      userId: adminUser.id,
      userName: adminUser.name,
      userEmail: adminUser.email,
      action: 'CREATE_MARKETPLACE',
      entityType: 'Marketplace',
      entityId: marketplace.id,
      description: `Created custom marketplace: ${name} (${region})`,
      metadata: { code, region, marketplaceType },
    });

    return NextResponse.json({
      success: true,
      data: marketplace,
    });
  } catch (error) {
    logger.error('Create marketplace error:', error);
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
