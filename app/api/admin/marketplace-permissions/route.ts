/**
 * Admin Marketplace Permissions API
 * GET:    List all OPERATOR users with their marketplace permissions
 * POST:   Upsert a marketplace permission for a user
 * DELETE: Remove a marketplace permission for a user
 */

import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { MarketplacePermissionSchema, UUIDParamSchema } from '@/lib/validation/schemas';
import { errorResponse } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const [users, marketplaces] = await Promise.all([
      prisma.user.findMany({
        where: { role: UserRole.OPERATOR, isActive: true },
        select: {
          id: true,
          name: true,
          email: true,
          permissions: {
            select: {
              marketplaceId: true,
              canView: true,
              canEdit: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.marketplace.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true, colorTag: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return NextResponse.json({ success: true, data: { users, marketplaces } });
  } catch (error) {
    return errorResponse(error, 'İzinler getirilemedi');
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const validation = MarketplacePermissionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { userId, marketplaceId, canView, canEdit } = validation.data;

    // Verify the target user exists and is an OPERATOR
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!targetUser || targetUser.role !== UserRole.OPERATOR) {
      return NextResponse.json(
        { success: false, error: 'Kullanıcı bulunamadı veya OPERATOR rolünde değil' },
        { status: 404 }
      );
    }

    const permission = await prisma.userMarketplacePermission.upsert({
      where: { userId_marketplaceId: { userId, marketplaceId } },
      update: { canView, canEdit },
      create: { userId, marketplaceId, canView, canEdit },
    });

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'UPDATE_MARKETPLACE',
      entityType: 'UserMarketplacePermission',
      entityId: userId,
      description: `Pazar yeri izni güncellendi: userId=${userId} marketplaceId=${marketplaceId} canView=${canView} canEdit=${canEdit}`,
      metadata: { userId, marketplaceId, canView, canEdit },
    });

    return NextResponse.json({ success: true, data: permission });
  } catch (error) {
    return errorResponse(error, 'İzin güncellenemedi');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const userIdResult = UUIDParamSchema.safeParse(body.userId);
    const marketplaceIdResult = UUIDParamSchema.safeParse(body.marketplaceId);

    if (!userIdResult.success || !marketplaceIdResult.success) {
      return NextResponse.json(
        { success: false, error: 'Geçersiz userId veya marketplaceId' },
        { status: 400 }
      );
    }

    const { data: userId } = userIdResult;
    const { data: marketplaceId } = marketplaceIdResult;

    await prisma.userMarketplacePermission.delete({
      where: { userId_marketplaceId: { userId, marketplaceId } },
    });

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'UPDATE_MARKETPLACE',
      entityType: 'UserMarketplacePermission',
      entityId: userId,
      description: `Pazar yeri izni kaldırıldı: userId=${userId} marketplaceId=${marketplaceId}`,
      metadata: { userId, marketplaceId, action: 'delete' },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, 'İzin kaldırılamadı');
  }
}
