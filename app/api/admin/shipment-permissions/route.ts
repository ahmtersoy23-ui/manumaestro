/**
 * Shipment Permissions CRUD
 * GET: List all shipment permissions
 * POST: Create/update permission
 * DELETE: Remove permission (?id=xxx)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/verify';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;

  const permissions = await prisma.userShipmentPermission.findMany({
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ user: { name: 'asc' } }, { destinationTab: 'asc' }],
  });

  return NextResponse.json({ success: true, data: permissions });
}

const UpsertSchema = z.object({
  userId: z.string().uuid(),
  destinationTab: z.string().min(1).max(5),
  role: z.enum(['VIEWER', 'ROUTER', 'PACKER', 'MANAGER']),
});

export async function POST(request: NextRequest) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;

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

  return NextResponse.json({ success: true, data: perm });
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult instanceof NextResponse) return authResult;

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'id gerekli' }, { status: 400 });

  await prisma.userShipmentPermission.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ success: true });
}
