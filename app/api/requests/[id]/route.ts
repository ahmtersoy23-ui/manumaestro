/**
 * Production Request DELETE API
 * DELETE: Delete a specific request
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { requireRole } from '@/lib/auth/verify';
import { logAction } from '@/lib/auditLog';

const logger = createLogger('Request API');

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limiting: 100 requests per minute for write operations
    const rateLimitResult = await rateLimiters.write.check(request, 'delete-request');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication & Authorization: Only admins can delete
    const authResult = await requireRole(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult; // Return error response
    }

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
      select: { iwasku: true, productName: true, quantity: true, productionMonth: true, marketplaceId: true },
    });

    // Delete the production request
    await prisma.productionRequest.delete({
      where: { id },
    });

    const { user } = authResult;
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
    logger.error('Delete request error:', error);

    // Check if it's a "not found" error
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      return NextResponse.json(
        {
          success: false,
          error: 'Talep bulunamadı',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Talep silinemedi',
      },
      { status: 500 }
    );
  }
}
