/**
 * Month Lock Toggle API
 * POST: Lock or unlock a month's allocations for a pool
 *
 * Body: { month: "2026-04", locked: true }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireSuperAdmin } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { z } from 'zod';

const LockMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  locked: z.boolean(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  // Süper-admin gerekli (sezon ay kilitleme kritik aksiyon)
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  const { id } = await params;

  const body = await request.json();
  const validation = LockMonthSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Doğrulama hatası', details: validation.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { month, locked } = validation.data;

  // Update all allocations for this pool + month
  const result = await prisma.monthlyAllocation.updateMany({
    where: {
      month,
      reserve: { poolId: id },
    },
    data: { locked },
  });

  await logAction({
    userId: user.id, userName: user.name, userEmail: user.email,
    action: 'UPDATE_REQUEST', entityType: 'MonthlyAllocation', entityId: `${id}/${month}`,
    description: `Ay ${locked ? 'kilitlendi' : 'kilidi açıldı'}: ${month}`,
    metadata: { poolId: id, month, locked, updatedCount: result.count },
  });

  return NextResponse.json({ success: true, data: { month, locked, updated: result.count } });
}
