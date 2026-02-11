/**
 * Audit Logs API
 * GET: List audit logs (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('Audit Logs API');

export async function GET(request: NextRequest) {
  try {
    // Get user from SSO headers (set by middleware)
    const userRole = request.headers.get('x-user-role');
    const userEmail = request.headers.get('x-user-email');

    // Check if user is admin
    if (userRole !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '100');
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
    logger.error('Fetch audit logs error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch audit logs',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
