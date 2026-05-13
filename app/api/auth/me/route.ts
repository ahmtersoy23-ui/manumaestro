import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { isSuperAdmin } from '@/lib/auth/verify';
import { withRoute } from '@/lib/api/withRoute';

/**
 * GET /api/auth/me
 * Returns current user info + permissions
 * Custom response shape (user/role/isSuperAdmin/permissions at top level, NOT under data).
 */
export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Sunucu hatası' },
  async ({ user }) => {
    // Check stock permission for non-admin users
    let canViewStock = user!.role === 'admin';
    if (!canViewStock) {
      const stockPerm = await prisma.userStockPermission.findUnique({
        where: { userId: user!.id },
      });
      canViewStock = stockPerm?.canView ?? false;
    }

    // Marketplace permissions (code-level): admin implicitly has all
    // Non-admin users get explicit UserMarketplacePermission rows joined with marketplaces
    let marketplacePermissions: { code: string; canView: boolean; canEdit: boolean }[] = [];
    if (user!.role === 'admin') {
      const allMps = await prisma.marketplace.findMany({
        where: { isActive: true },
        select: { code: true },
      });
      marketplacePermissions = allMps.map(m => ({ code: m.code, canView: true, canEdit: true }));
    } else {
      const rows = await prisma.userMarketplacePermission.findMany({
        where: { userId: user!.id },
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
        id: user!.id,
        email: user!.email,
        name: user!.name,
      },
      role: user!.role,
      isSuperAdmin: isSuperAdmin(user!.email),
      permissions: { canViewStock, marketplaces: marketplacePermissions },
    });
  }
);
