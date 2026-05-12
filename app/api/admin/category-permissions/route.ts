/**
 * Admin Category Permissions API
 * GET:    List all OPERATOR users with their category permissions + available categories
 * POST:   Upsert a category permission for a user
 * DELETE: Remove a category permission for a user
 */

import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { logAction } from '@/lib/auditLog';
import { CategoryPermissionSchema, UUIDParamSchema } from '@/lib/validation/schemas';
import { z } from 'zod';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute(
  { roles: ['admin'], rateLimit: 'read', fallbackMessage: 'Kategori izinleri getirilemedi' },
  async () => {
    const [users, reqCategories, permCategories] = await Promise.all([
      prisma.user.findMany({
        where: { role: UserRole.OPERATOR, isActive: true },
        select: {
          id: true,
          name: true,
          email: true,
          categoryPermissions: {
            select: {
              category: true,
              canView: true,
              canEdit: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.productionRequest.findMany({
        select: { productCategory: true },
        distinct: ['productCategory'],
      }),
      prisma.userCategoryPermission.findMany({
        select: { category: true },
        distinct: ['category'],
      }),
    ]);

    // Merge categories from both production requests and existing permissions
    const categories = [...new Set([
      ...reqCategories.map(r => r.productCategory),
      ...permCategories.map(p => p.category),
    ])].filter(Boolean).sort();

    return successResponse({ users, categories });
  }
);

export const POST = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Kategori izni güncellenemedi' },
  async ({ request, user }) => {
    const body = await request.json();
    const validation = CategoryPermissionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { userId, category, canView, canEdit } = validation.data;

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

    const permission = await prisma.userCategoryPermission.upsert({
      where: { userId_category: { userId, category } },
      update: { canView, canEdit },
      create: { userId, category, canView, canEdit },
    });

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: 'UPDATE_MARKETPLACE',
      entityType: 'UserCategoryPermission',
      entityId: userId,
      description: `Kategori izni güncellendi: userId=${userId} category=${category} canView=${canView} canEdit=${canEdit}`,
      metadata: { userId, category, canView, canEdit },
    });

    return successResponse(permission);
  }
);

export const DELETE = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Kategori izni kaldırılamadı' },
  async ({ request, user }) => {
    const body = await request.json();
    const userIdResult = UUIDParamSchema.safeParse(body.userId);
    const categoryResult = z.string().min(1).max(100).safeParse(body.category);

    if (!userIdResult.success || !categoryResult.success) {
      return NextResponse.json(
        { success: false, error: 'Geçersiz userId veya category' },
        { status: 400 }
      );
    }

    const { data: userId } = userIdResult;
    const { data: category } = categoryResult;

    await prisma.userCategoryPermission.delete({
      where: { userId_category: { userId, category } },
    });

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: 'UPDATE_MARKETPLACE',
      entityType: 'UserCategoryPermission',
      entityId: userId,
      description: `Kategori izni kaldırıldı: userId=${userId} category=${category}`,
      metadata: { userId, category, action: 'delete' },
    });

    return NextResponse.json({ success: true });
  }
);
