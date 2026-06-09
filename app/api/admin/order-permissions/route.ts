/**
 * Admin Order Board Permissions API
 * Sipariş board kademeli izni (UserOrderPermission) — shelf/depo izninden bağımsız.
 * GET:  OPERATOR kullanıcıları + mevcut kademe (NONE/APPROVER/CREATOR/FULL)
 * POST: kullanıcıya kademe ata (upsert)
 */

import { NextResponse } from 'next/server';
import { UserRole, OrderBoardLevel } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { z } from 'zod';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const Schema = z.object({
  userId: z.string().uuid(),
  level: z.enum(['NONE', 'APPROVER', 'CREATOR', 'FULL']),
});

export const GET = withRoute(
  { roles: ['admin'], rateLimit: 'read', fallbackMessage: 'Sipariş izinleri getirilemedi' },
  async () => {
    const users = await prisma.user.findMany({
      where: { role: UserRole.OPERATOR, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        orderPermission: { select: { level: true } },
      },
      orderBy: { name: 'asc' },
    });
    return successResponse({ users });
  },
);

export const POST = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Sipariş izni güncellenemedi' },
  async ({ request }) => {
    const body = await request.json();
    const validation = Schema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: validation.error.issues },
        { status: 400 },
      );
    }
    const { userId, level } = validation.data;

    const permission = await prisma.userOrderPermission.upsert({
      where: { userId },
      update: { level: level as OrderBoardLevel },
      create: { userId, level: level as OrderBoardLevel },
    });

    return successResponse(permission);
  },
);
