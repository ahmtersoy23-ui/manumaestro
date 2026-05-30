/**
 * Bulk Delete Production Requests
 * DELETE: Tek marketplace + productionMonth için STOCKPULSE entryType
 * (üretilmemiş/iptal edilmemiş) talepleri toplu sil. Manuel/Excel ve
 * COMPLETED/CANCELLED kayıtlar dokunulmaz.
 *
 * Body: { marketplaceId: string, productionMonth: 'YYYY-MM' }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RequestStatus, EntryType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireSuperAdmin } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { revalidateTag } from 'next/cache';
import { withRoute } from '@/lib/api/withRoute';

const BodySchema = z.object({
  marketplaceId: z.string().min(1),
  productionMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

export const POST = withRoute(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Toplu silme başarısız' },
  async ({ request }) => {
    const authResult = await requireSuperAdmin(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const body = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Geçersiz parametre' },
        { status: 400 },
      );
    }
    const { marketplaceId, productionMonth } = parsed.data;

    // Sadece STOCKPULSE + REQUESTED/IN_PROGRESS/PARTIALLY_PRODUCED kayıtlar silinir
    const where = {
      marketplaceId,
      productionMonth,
      entryType: EntryType.STOCKPULSE,
      status: { notIn: [RequestStatus.COMPLETED, RequestStatus.CANCELLED] },
    };

    const targets = await prisma.productionRequest.findMany({
      where,
      select: { id: true, iwasku: true, productName: true, quantity: true },
    });

    if (targets.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Silinecek STOCKPULSE talebi yok',
        deleted: 0,
      });
    }

    const deleted = await prisma.productionRequest.deleteMany({
      where: { id: { in: targets.map(t => t.id) } },
    });

    const marketplace = await prisma.marketplace.findUnique({
      where: { id: marketplaceId },
      select: { code: true, name: true },
    });

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'BULK_UPLOAD',
      entityType: 'ProductionRequest',
      entityId: marketplaceId,
      description:
        `Toplu silme: ${marketplace?.code ?? marketplaceId} / ${productionMonth} — ` +
        `${deleted.count} STOCKPULSE talebi silindi (manuel/kapalı dokunulmadı)`,
      metadata: {
        marketplaceId,
        marketplaceCode: marketplace?.code,
        productionMonth,
        deletedCount: deleted.count,
        sample: targets.slice(0, 10).map(t => ({
          iwasku: t.iwasku, productName: t.productName, quantity: t.quantity,
        })),
      },
    });

    revalidateTag('dashboard-stats', 'default');

    return NextResponse.json({
      success: true,
      message: `${deleted.count} talep silindi`,
      deleted: deleted.count,
    });
  },
);
