import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { verifyAuth } from '@/lib/auth/verify';

const logger = createLogger('Auth Me API');

/**
 * GET /api/auth/me
 * Returns current user info + permissions
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await rateLimiters.read.check(request, 'auth-me');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    const auth = await verifyAuth(request);
    if (!auth.success || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    // Check stock permission for non-admin users
    let canViewStock = auth.user.role === 'admin';
    if (!canViewStock) {
      const stockPerm = await prisma.userStockPermission.findUnique({
        where: { userId: auth.user.id },
      });
      canViewStock = stockPerm?.canView ?? false;
    }

    return NextResponse.json({
      success: true,
      user: {
        id: auth.user.id,
        email: auth.user.email,
        name: auth.user.name,
      },
      role: auth.user.role,
      permissions: { canViewStock },
    });
  } catch (error) {
    logger.error('Error in /api/auth/me:', error);
    return NextResponse.json(
      { success: false, error: 'Sunucu hatası' },
      { status: 500 }
    );
  }
}
