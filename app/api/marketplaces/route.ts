/**
 * Marketplaces API
 * GET: List all active marketplaces
 * POST: Create new custom marketplace
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { logAction } from '@/lib/auditLog';
import { MarketplaceCreateSchema, formatValidationError } from '@/lib/validation/schemas';
import { successResponse, createdResponse, errorResponse } from '@/lib/api/response';
import { ValidationError, InternalServerError, NotFoundError } from '@/lib/api/errors';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { verifyAuth, requireRole } from '@/lib/auth/verify';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting: 200 requests per minute for read operations
    const rateLimitResult = await rateLimiters.read.check(request, 'list-marketplaces');
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

    const searchParams = request.nextUrl.searchParams;

    // Pagination parameters
    const rawPage = parseInt(searchParams.get('page') || '1');
    const rawLimit = parseInt(searchParams.get('limit') || '50');
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 1), 200);
    const skip = (page - 1) * limit;

    const where = { isActive: true };

    const [marketplaces, total] = await Promise.all([
      prisma.marketplace.findMany({
        where,
        orderBy: {
          name: 'asc',
        },
        skip,
        take: limit,
      }),
      prisma.marketplace.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return successResponse(marketplaces, {
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch marketplaces');
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting: 100 requests per minute for write operations
    const rateLimitResult = await rateLimiters.write.check(request, 'create-marketplace');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication & Authorization: Admin only
    const authResult = await requireRole(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    const body = await request.json();

    // Validate with Zod
    const validation = MarketplaceCreateSchema.safeParse(body);
    if (!validation.success) {
      throw new ValidationError('Validation failed', formatValidationError(validation.error));
    }

    const { name, region, marketplaceType } = validation.data;

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
        createdById: user.id,
      },
    });

    // Log action with authenticated user
    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'CREATE_MARKETPLACE',
      entityType: 'Marketplace',
      entityId: marketplace.id,
      description: `Created custom marketplace: ${name} (${region})`,
      metadata: { code, region, marketplaceType },
    });

    return createdResponse(marketplace);
  } catch (error) {
    return errorResponse(error, 'Failed to create marketplace');
  }
}
