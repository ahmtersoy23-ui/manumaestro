/**
 * Shipment Permissions CRUD
 * GET: List all shipment permissions
 * POST: Create/update permission
 * DELETE: Remove permission (?id=xxx)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { z } from 'zod';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

export const GET = withRoute(
  { roles: ['admin'], rateLimit: 'read', fallbackMessage: 'Sevkiyat izinleri getirilemedi' },
  async () => {
    const permissions = await prisma.userShipmentPermission.findMany({
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ user: { name: 'asc' } }, { destinationTab: 'asc' }],
    });
    return successResponse(permissions);
  }
);

const UpsertSchema = z.object({
  userId: z.string().uuid(),
  destinationTab: z.string().min(1).max(5),
  role: z.enum(['VIEWER', 'ROUTER', 'PACKER', 'MANAGER']),
});

export const POST = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Sevkiyat izni güncellenemedi' },
  async ({ request }) => {
    const body = await request.json();
    const validation = UpsertSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ success: false, error: 'Doğrulama hatası' }, { status: 400 });
    }

    const { userId, destinationTab, role } = validation.data;

    const perm = await prisma.userShipmentPermission.upsert({
      where: { userId_destinationTab: { userId, destinationTab } },
      create: { userId, destinationTab, role },
      update: { role },
    });

    return successResponse(perm);
  }
);

export const DELETE = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Sevkiyat izni kaldırılamadı' },
  async ({ request }) => {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'id gerekli' }, { status: 400 });
    }

    await prisma.userShipmentPermission.delete({ where: { id } }).catch(() => null);
    return NextResponse.json({ success: true });
  }
);
