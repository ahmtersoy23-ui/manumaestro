/**
 * Admin Category Permissions API
 * GET:    List all OPERATOR users with their category permissions + available categories
 * POST:   Upsert a category permission for a user
 * DELETE: Remove a category permission for a user
 */

import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { CategoryPermissionSchema, UUIDParamSchema } from '@/lib/validation/schemas';
import { errorResponse } from '@/lib/api/response';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const [users, categoryRows] = await Promise.all([
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
        orderBy: { productCategory: 'asc' },
      }),
    ]);

    const categories = categoryRows.map(r => r.productCategory).filter(Boolean);

    return NextResponse.json({ success: true, data: { users, categories } });
  } catch (error) {
    return errorResponse(error, 'Kategori izinleri getirilemedi');
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

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
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'UPDATE_MARKETPLACE',
      entityType: 'UserCategoryPermission',
      entityId: userId,
      description: `Kategori izni güncellendi: userId=${userId} category=${category} canView=${canView} canEdit=${canEdit}`,
      metadata: { userId, category, canView, canEdit },
    });

    return NextResponse.json({ success: true, data: permission });
  } catch (error) {
    return errorResponse(error, 'Kategori izni güncellenemedi');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

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
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'UPDATE_MARKETPLACE',
      entityType: 'UserCategoryPermission',
      entityId: userId,
      description: `Kategori izni kaldırıldı: userId=${userId} category=${category}`,
      metadata: { userId, category, action: 'delete' },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, 'Kategori izni kaldırılamadı');
  }
}
