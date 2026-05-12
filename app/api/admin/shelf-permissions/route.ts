/**
 * Admin Shelf Permissions API — UserShelfPermission yönetimi.
 * GET:  OPERATOR users + her birinin depo başına shelf rolleri
 * POST: Upsert (userId, warehouseCode, role)
 * DELETE: bir kayıt sil (role=NONE eşdeğeri)
 *
 * Roller: VIEWER | PACKER | OPERATOR | MANAGER | ADMIN
 * warehouseCode: ANKARA | NJ | SHOWROOM | "*" (tüm depolar)
 */

import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const VALID_WAREHOUSES = ['ANKARA', 'NJ', 'SHOWROOM', '*'] as const;
const VALID_ROLES = ['VIEWER', 'PACKER', 'OPERATOR', 'MANAGER', 'ADMIN'] as const;

const UpsertSchema = z.object({
  userId: z.string().uuid(),
  warehouseCode: z.enum(VALID_WAREHOUSES),
  role: z.enum(VALID_ROLES),
});

const DeleteSchema = z.object({
  userId: z.string().uuid(),
  warehouseCode: z.enum(VALID_WAREHOUSES),
});

export const GET = withRoute(
  { roles: ['admin'], rateLimit: 'read', fallbackMessage: 'Depo rolleri getirilemedi' },
  async () => {
    const users = await prisma.user.findMany({
      where: { role: UserRole.OPERATOR, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });

    const permissions = await prisma.userShelfPermission.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
      select: { userId: true, warehouseCode: true, role: true },
    });

    const byUser = new Map<string, Record<string, string>>();
    for (const p of permissions) {
      const cur = byUser.get(p.userId) ?? {};
      cur[p.warehouseCode] = p.role;
      byUser.set(p.userId, cur);
    }

    return successResponse({
      warehouses: ['ANKARA', 'NJ', 'SHOWROOM'],
      users: users.map((u) => ({
        ...u,
        permissions: byUser.get(u.id) ?? {},
      })),
    });
  }
);

export const POST = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Depo rolü güncellenemedi' },
  async ({ request, user }) => {
    const body = await request.json();
    const parsed = UpsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { userId, warehouseCode, role } = parsed.data;

    const permission = await prisma.userShelfPermission.upsert({
      where: { userId_warehouseCode: { userId, warehouseCode } },
      update: { role },
      create: { userId, warehouseCode, role },
    });

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: 'UPDATE_STOCK',
      entityType: 'UserShelfPermission',
      entityId: userId,
      description: `Depo rolü atandı: ${warehouseCode} → ${role}`,
      metadata: { userId, warehouseCode, role },
    });

    return successResponse(permission);
  }
);

export const DELETE = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Depo rolü kaldırılamadı' },
  async ({ request, user }) => {
    const body = await request.json();
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { userId, warehouseCode } = parsed.data;

    await prisma.userShelfPermission
      .delete({ where: { userId_warehouseCode: { userId, warehouseCode } } })
      .catch(() => {/* zaten yoksa sorun değil */});

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: 'UPDATE_STOCK',
      entityType: 'UserShelfPermission',
      entityId: userId,
      description: `Depo rolü kaldırıldı: ${warehouseCode}`,
      metadata: { userId, warehouseCode, action: 'delete' },
    });

    return NextResponse.json({ success: true });
  }
);
