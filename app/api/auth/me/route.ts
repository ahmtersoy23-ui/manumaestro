import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { verifyAuth } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';

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

    // Marketplace permissions (code-level): admin implicitly has all
    // Non-admin users get explicit UserMarketplacePermission rows joined with marketplaces
    let marketplacePermissions: { code: string; canView: boolean; canEdit: boolean }[] = [];
    if (auth.user.role === 'admin') {
      const allMps = await prisma.marketplace.findMany({
        where: { isActive: true },
        select: { code: true },
      });
      marketplacePermissions = allMps.map(m => ({ code: m.code, canView: true, canEdit: true }));
    } else {
      const rows = await prisma.userMarketplacePermission.findMany({
        where: { userId: auth.user.id },
        select: { canView: true, canEdit: true, marketplace: { select: { code: true } } },
      });
      marketplacePermissions = rows.map(r => ({
        code: r.marketplace.code,
        canView: r.canView,
        canEdit: r.canEdit,
      }));
    }

    return NextResponse.json({
      success: true,
      user: {
        id: auth.user.id,
        email: auth.user.email,
        name: auth.user.name,
      },
      role: auth.user.role,
      permissions: { canViewStock, marketplaces: marketplacePermissions },
    });
  } catch (error) {
    return errorResponse(error, 'Sunucu hatası');
  }
}
