/**
 * POST /api/production-suggestions/[id]/accept
 * Suggestion'ı kabul et → ProductionRequest yarat (entryType=STOCKPULSE),
 * status=ACCEPTED, acceptedRequestId set. Mevcut requests upsert mantığını
 * yeniden uygular (iwasku, marketplace, productionMonth tekrar varsa update).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { EntryType, RequestStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { checkMarketplacePermission, isSuperAdmin } from '@/lib/auth/verify';
import { successResponse } from '@/lib/api/response';
import { withRoute } from '@/lib/api/withRoute';
import { isMonthLocked } from '@/lib/monthUtils';
import { logAction } from '@/lib/auditLog';
import { revalidateTag } from 'next/cache';

const BodySchema = z.object({
  quantity: z.number().int().positive().max(999999).optional(), // varsayilan: suggestedQty
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().default('MEDIUM'),
  notes: z.string().max(500).optional().nullable(),
});

export const POST = withRoute<{ id: string }>(
  { rateLimit: 'write', fallbackMessage: 'Öneri kabul edilemedi' },
  async ({ request, user, params }) => {
    const { id } = params;
    const body = await request.json().catch(() => ({}));
    const v = BodySchema.safeParse(body);
    if (!v.success) {
      return NextResponse.json(
        { success: false, error: 'Doğrulama hatası', details: v.error.flatten() },
        { status: 400 },
      );
    }

    const suggestion = await prisma.productionSuggestion.findUnique({
      where: { id },
      include: { marketplace: true },
    });
    if (!suggestion) {
      return NextResponse.json({ success: false, error: 'Öneri bulunamadı' }, { status: 404 });
    }
    if (suggestion.status !== 'PENDING' && suggestion.status !== 'EXPIRED') {
      return NextResponse.json(
        { success: false, error: `Öneri zaten ${suggestion.status} durumunda` },
        { status: 409 },
      );
    }

    const userIsSuperAdmin = isSuperAdmin(user!.email);
    if (!userIsSuperAdmin) {
      if (isMonthLocked(suggestion.productionMonth)) {
        return NextResponse.json(
          { success: false, error: `${suggestion.productionMonth} ayı kilitli.` },
          { status: 403 },
        );
      }
      const perm = await checkMarketplacePermission(
        user!.id, user!.role, suggestion.marketplaceId, 'edit',
      );
      if (!perm.allowed) {
        return NextResponse.json(
          { success: false, error: perm.reason || 'Yetki yok' },
          { status: 403 },
        );
      }
    }

    const quantity = v.data.quantity ?? suggestion.suggestedQty;
    const priority = v.data.priority ?? 'MEDIUM';
    const notes = v.data.notes ?? null;

    // Mevcut ProductionRequest upsert
    const existingReq = await prisma.productionRequest.findFirst({
      where: {
        iwasku: suggestion.iwasku,
        marketplaceId: suggestion.marketplaceId,
        productionMonth: suggestion.productionMonth,
      },
      select: { id: true, quantity: true },
    });

    const request_ = await prisma.$transaction(async (tx) => {
      let pr;
      if (existingReq) {
        pr = await tx.productionRequest.update({
          where: { id: existingReq.id },
          data: { quantity, priority, notes, entryType: EntryType.STOCKPULSE },
        });
      } else {
        pr = await tx.productionRequest.create({
          data: {
            iwasku: suggestion.iwasku,
            productName: suggestion.productName,
            productCategory: suggestion.productCategory,
            productSize: suggestion.productSize,
            marketplaceId: suggestion.marketplaceId,
            quantity,
            requestDate: new Date(),
            productionMonth: suggestion.productionMonth,
            priority,
            notes,
            entryType: EntryType.STOCKPULSE,
            status: RequestStatus.REQUESTED,
            enteredById: user!.id,
          },
        });
      }

      await tx.productionSuggestion.update({
        where: { id: suggestion.id },
        data: {
          status: 'ACCEPTED',
          acceptedRequestId: pr.id,
          decidedAt: new Date(),
          decidedById: user!.id,
        },
      });

      return pr;
    });

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: existingReq ? 'UPDATE_REQUEST' : 'CREATE_REQUEST',
      entityType: 'ProductionRequest',
      entityId: request_.id,
      description: `Öneri kabul edildi (StockPulse): ${suggestion.iwasku} — ${suggestion.productName} (${quantity} adet, ${suggestion.productionMonth}, ${suggestion.marketplace.code})`,
      metadata: {
        suggestionId: suggestion.id,
        formulaVersion: suggestion.formulaVersion,
        suggestedQty: suggestion.suggestedQty,
        acceptedQty: quantity,
        marketplaceCode: suggestion.marketplace.code,
      },
    });

    revalidateTag('dashboard-stats', 'default');

    return successResponse({ request: request_, suggestionId: suggestion.id });
  },
);
