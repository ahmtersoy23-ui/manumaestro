/**
 * Audit Logs API
 * GET: List audit logs (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { requireRole } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting: 200 requests per minute for read operations
    const rateLimitResult = await rateLimiters.read.check(request, 'audit-logs');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication & Authorization: Admin only
    const authResult = await requireRole(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const searchParams = request.nextUrl.searchParams;

    // FIX 6: Add max limit of 500
    const rawLimit = parseInt(searchParams.get('limit') || '100');
    const limit = Math.min(Math.max(rawLimit, 1), 500); // min 1, max 500
    const action = searchParams.get('action');
    const userId = searchParams.get('userId');

    const where: any = {};

    if (action) {
      where.action = action;
    }

    if (userId) {
      where.userId = userId;
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      include: {
        user: {
          select: {
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch audit logs');
  }
}
