/**
 * Monthly Capacity API
 * GET  /api/seasonal/capacity            — Tüm ayların kapasite kayıtları (admin)
 * PUT  /api/seasonal/capacity            — Tek ay upsert (admin)
 *
 * Body (PUT): { month: 'YYYY-MM', dailyDesi: number, workingDays: number, notes?: string }
 *
 * Aylık üretim tavanı = dailyDesi × workingDays.
 * İleride sezonsal allocator + sezonsal SKU üst sınır kriteri bu rakamı kullanır.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireSuperAdmin } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { withRoute } from '@/lib/api/withRoute';

const PutSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM bekleniyor'),
  dailyDesi: z.number().int().min(0).max(100000),
  workingDays: z.number().int().min(0).max(31),
  notes: z.string().max(500).optional().nullable(),
});

export const GET = withRoute(
  { skipAuth: true, rateLimit: 'read', fallbackMessage: 'Kapasite okunamadı' },
  async ({ request }) => {
    const authResult = await requireSuperAdmin(request);
    if (authResult instanceof NextResponse) return authResult;

    const items = await prisma.monthlyCapacity.findMany({
      orderBy: { month: 'desc' },
      include: { updatedBy: { select: { name: true, email: true } } },
    });

    return NextResponse.json({ success: true, data: items });
  },
);

export const PUT = withRoute(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Kapasite güncellenemedi' },
  async ({ request }) => {
    const authResult = await requireSuperAdmin(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const body = await request.json().catch(() => ({}));
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Geçersiz parametre', details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { month, dailyDesi, workingDays, notes } = parsed.data;

    const existing = await prisma.monthlyCapacity.findUnique({ where: { month } });
    const item = await prisma.monthlyCapacity.upsert({
      where: { month },
      create: { month, dailyDesi, workingDays, notes: notes ?? null, updatedById: user.id },
      update: { dailyDesi, workingDays, notes: notes ?? null, updatedById: user.id },
    });

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'UPDATE_PRODUCTION',
      entityType: 'MonthlyCapacity',
      entityId: item.id,
      description: existing
        ? `Kapasite güncellendi: ${month} → ${dailyDesi} desi/gün × ${workingDays} gün = ${dailyDesi * workingDays}`
        : `Kapasite oluşturuldu: ${month} → ${dailyDesi} desi/gün × ${workingDays} gün = ${dailyDesi * workingDays}`,
      metadata: { month, dailyDesi, workingDays, total: dailyDesi * workingDays },
    });

    return NextResponse.json({ success: true, data: item });
  },
);
