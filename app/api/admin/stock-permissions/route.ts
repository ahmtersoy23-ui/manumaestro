/**
 * Admin Stock Permissions API
 * GET:    List all OPERATOR users with their stock permissions
 * POST:   Upsert stock permission for a user
 * DELETE: Remove stock permission for a user
 */

import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const StockPermissionSchema = z.object({
  userId: z.string().uuid(),
  canView: z.boolean(),
  canEdit: z.boolean(),
}).refine(d => !(d.canEdit && !d.canView), {
  message: 'Düzenleme izni görüntüleme iznini gerektirir',
  path: ['canView'],
});

export const GET = withRoute(
  { roles: ['admin'], rateLimit: 'read', fallbackMessage: 'Stok izinleri getirilemedi' },
  async () => {
    const users = await prisma.user.findMany({
      where: { role: UserRole.OPERATOR, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        stockPermission: {
          select: { canView: true, canEdit: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return successResponse({ users });
  }
);

export const POST = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Stok izni güncellenemedi' },
  async ({ request, user }) => {
    const body = await request.json();
    const validation = StockPermissionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { userId, canView, canEdit } = validation.data;

    const permission = await prisma.userStockPermission.upsert({
      where: { userId },
      update: { canView, canEdit },
      create: { userId, canView, canEdit },
    });

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: 'UPDATE_STOCK',
      entityType: 'UserStockPermission',
      entityId: userId,
      description: `Stok izni güncellendi: canView=${canView} canEdit=${canEdit}`,
      metadata: { userId, canView, canEdit },
    });

    return successResponse(permission);
  }
);

export const DELETE = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Stok izni kaldırılamadı' },
  async ({ request, user }) => {
    const body = await request.json();
    const userIdResult = z.string().uuid().safeParse(body.userId);
    if (!userIdResult.success) {
      return NextResponse.json(
        { success: false, error: 'Geçersiz userId' },
        { status: 400 }
      );
    }

    await prisma.userStockPermission.delete({
      where: { userId: userIdResult.data },
    });

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: 'UPDATE_STOCK',
      entityType: 'UserStockPermission',
      entityId: userIdResult.data,
      description: `Stok izni kaldırıldı`,
      metadata: { userId: userIdResult.data, action: 'delete' },
    });

    return NextResponse.json({ success: true });
  }
);
