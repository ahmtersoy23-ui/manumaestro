/**
 * POST /api/production-suggestions/[id]/dismiss
 * Suggestion'ı reddet. status=DISMISSED, sonraki sync'lerde geri yazılmaz.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { checkMarketplacePermission, isSuperAdmin } from '@/lib/auth/verify';
import { successResponse } from '@/lib/api/response';
import { withRoute } from '@/lib/api/withRoute';
import { logAction } from '@/lib/auditLog';

const BodySchema = z.object({ reason: z.string().max(500).optional().nullable() });

export const POST = withRoute<{ id: string }>(
  { rateLimit: 'write', fallbackMessage: 'Öneri reddedilemedi' },
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

    await prisma.productionSuggestion.update({
      where: { id },
      data: {
        status: 'DISMISSED',
        decidedAt: new Date(),
        decidedById: user!.id,
        reasoning: v.data.reason
          ? `[REDDED] ${v.data.reason}${suggestion.reasoning ? '\n---\n' + suggestion.reasoning : ''}`
          : suggestion.reasoning,
      },
    });

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: 'UPDATE_REQUEST',
      entityType: 'ProductionSuggestion',
      entityId: id,
      description: `Öneri reddedildi: ${suggestion.iwasku} — ${suggestion.marketplace.code} ${suggestion.productionMonth}${v.data.reason ? ` (${v.data.reason})` : ''}`,
      metadata: { suggestionId: id, reason: v.data.reason },
    });

    return successResponse({ ok: true });
  },
);
