/**
 * Production Request DELETE API
 * DELETE: Delete a specific request
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { requireSuperAdmin } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';
import { errorResponse } from '@/lib/api/response';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await rateLimiters.write.check(request, 'delete-request');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authorization: Süper-admin gerekli (talep silme kritik aksiyon)
    const authResult = await requireSuperAdmin(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    const { id } = await params;

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

    return NextResponse.json({
      success: true,
      message: 'Talep başarıyla silindi',
    });
  } catch (error) {
    return errorResponse(error, 'Talep silinemedi');
  }
}
