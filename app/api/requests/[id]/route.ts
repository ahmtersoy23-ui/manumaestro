/**
 * Production Request API
 * DELETE: Delete a specific request (kalıcı silme)
 * PATCH:  Update status (örn. CANCELLED) — kalıcı silmeden iptal etmek için
 */

import { NextResponse } from 'next/server';
import { RequestStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireSuperAdmin } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { revalidateTag } from 'next/cache';
import { withRoute } from '@/lib/api/withRoute';

// requireSuperAdmin audit-log'lu kritik aksiyon — handler içinde tutuluyor.
export const DELETE = withRoute<{ id: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Talep silinemedi' },
  async ({ request, params }) => {
    const authResult = await requireSuperAdmin(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    const { id } = params;

    if (!id) {
      return NextResponse.json(
        { error: 'Talep ID gereklidir' },
        { status: 400 }
      );
    }

    // Fetch request info before deleting (for audit log)
    const existingRequest = await prisma.productionRequest.findUnique({
      where: { id },
      select: { iwasku: true, productName: true, quantity: true, productionMonth: true, marketplaceId: true, enteredById: true },
    });

    if (!existingRequest) {
      return NextResponse.json({ success: false, error: 'Talep bulunamadı' }, { status: 404 });
    }

    // Delete the production request
    await prisma.productionRequest.delete({
      where: { id },
    });
    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'DELETE_REQUEST',
      entityType: 'ProductionRequest',
      entityId: id,
      description: existingRequest
        ? `Talep silindi: ${existingRequest.iwasku} — ${existingRequest.productName} (${existingRequest.quantity} adet, ${existingRequest.productionMonth})`
        : `Talep silindi: ${id}`,
      metadata: existingRequest ? { ...existingRequest, id } : { id },
    });

    revalidateTag('dashboard-stats', 'default');

    return NextResponse.json({
      success: true,
      message: 'Talep başarıyla silindi',
    });
  }
);

// PATCH /api/requests/[id] — status güncelle (özellikle CANCELLED için).
// Kalıcı silme yerine kayıt korunur, status='CANCELLED' işlenir. ManuMaestro sync
// idempotency kuralı bu kayıtları dokunulmaz tutar (STOCKPULSE override yapmaz).
export const PATCH = withRoute<{ id: string }>(
  { skipAuth: true, rateLimit: 'write', fallbackMessage: 'Talep güncellenemedi' },
  async ({ request, params }) => {
    const authResult = await requireSuperAdmin(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    const { id } = params;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Talep ID gereklidir' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const newStatus = body?.status;
    // Şu anda sadece CANCELLED destekleniyor; ileride PARTIALLY_PRODUCED vs eklenebilir.
    if (newStatus !== 'CANCELLED') {
      return NextResponse.json(
        { success: false, error: 'Geçersiz status — sadece CANCELLED destekleniyor' },
        { status: 400 },
      );
    }

    const existing = await prisma.productionRequest.findUnique({
      where: { id },
      select: { iwasku: true, productName: true, quantity: true, productionMonth: true, status: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Talep bulunamadı' }, { status: 404 });
    }

    const updated = await prisma.productionRequest.update({
      where: { id },
      data: { status: RequestStatus.CANCELLED },
    });

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'UPDATE_REQUEST',
      entityType: 'ProductionRequest',
      entityId: id,
      description: `Talep iptal edildi: ${existing.iwasku} — ${existing.productName} (${existing.quantity} adet, ${existing.productionMonth})`,
      metadata: { id, previousStatus: existing.status, newStatus: 'CANCELLED' },
    });

    revalidateTag('dashboard-stats', 'default');

    return NextResponse.json({
      success: true,
      message: 'Talep iptal edildi',
      data: { id: updated.id, status: updated.status },
    });
  },
);
