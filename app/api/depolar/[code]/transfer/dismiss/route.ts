/**
 * POST   /api/depolar/[code]/transfer/dismiss  — bir iwasku'nun transfer önerisini yok say
 * DELETE /api/depolar/[code]/transfer/dismiss  — yok saymayı geri al
 *
 * Yalnız Somerset (NJ). dismissedAt kaydedilir; öneri sorgusu son olaydan
 * sonra yok sayılmışsa gizler. Yeni olay (Fairfield çıkışı / koli kırma)
 * olursa öneri otomatik geri belirir.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireShelfAction } from '@/lib/auth/requireShelfRole';
import { withRoute } from '@/lib/api/withRoute';
import { successResponse } from '@/lib/api/response';

const BodySchema = z.object({ iwasku: z.string().trim().min(1) });

async function parseIwasku(request: Request): Promise<string | NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Geçersiz JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'iwasku gerekli' }, { status: 400 });
  }
  return parsed.data.iwasku;
}

export const POST = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Yok sayma başarısız' },
  async ({ request, params }) => {
    if (params.code.toUpperCase() !== 'NJ') {
      return NextResponse.json({ success: false, error: 'Yalnız Somerset (NJ)' }, { status: 400 });
    }
    const auth = await requireShelfAction(request, 'NJ', 'crossWarehouseTransfer');
    if (auth instanceof NextResponse) return auth;

    const iwasku = await parseIwasku(request);
    if (iwasku instanceof NextResponse) return iwasku;

    await prisma.transferDismissal.upsert({
      where: { iwasku },
      create: { iwasku, dismissedById: auth.user.id },
      update: { dismissedAt: new Date(), dismissedById: auth.user.id },
    });
    return successResponse({ iwasku, dismissed: true });
  }
);

export const DELETE = withRoute<{ code: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Geri alma başarısız' },
  async ({ request, params }) => {
    if (params.code.toUpperCase() !== 'NJ') {
      return NextResponse.json({ success: false, error: 'Yalnız Somerset (NJ)' }, { status: 400 });
    }
    const auth = await requireShelfAction(request, 'NJ', 'crossWarehouseTransfer');
    if (auth instanceof NextResponse) return auth;

    const iwasku = await parseIwasku(request);
    if (iwasku instanceof NextResponse) return iwasku;

    await prisma.transferDismissal.deleteMany({ where: { iwasku } });
    return successResponse({ iwasku, dismissed: false });
  }
);
