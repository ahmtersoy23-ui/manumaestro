/**
 * Update Manufacturer Request API
 * Updates produced quantity, manufacturer notes, and status
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ManufacturerUpdateSchema, UUIDParamSchema, formatValidationError } from '@/lib/validation/schemas';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { requireRole, checkCategoryPermission } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';
import { logAction } from '@/lib/auditLog';
import { waterfallComplete } from '@/lib/waterfallComplete';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limiting: 100 requests per minute for write operations
    const rateLimitResult = await rateLimiters.write.check(request, 'manufacturer-update');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication & Authorization: Require editor or admin role
    const authResult = await requireRole(request, ['admin', 'editor']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    const { id } = await params;

    // Validate ID format
    const idValidation = UUIDParamSchema.safeParse(id);
    if (!idValidation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Geçersiz talep ID formatı',
        },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Validate body
    const bodyValidation = ManufacturerUpdateSchema.safeParse(body);
    if (!bodyValidation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Doğrulama hatası',
          details: formatValidationError(bodyValidation.error),
        },
        { status: 400 }
      );
    }

    const { producedQuantity, manufacturerNotes, status, workflowStage } = bodyValidation.data;

    // Fetch the request to get quantity, category, and month
    const existingRequest = await prisma.productionRequest.findUnique({
      where: { id },
      select: { iwasku: true, productName: true, quantity: true, productCategory: true, productionMonth: true },
    });

    if (!existingRequest) {
      return NextResponse.json(
        { error: 'Talep bulunamadı' },
        { status: 404 }
      );
    }

    // Category permission check for OPERATOR users (üretim durumu kategori bazlı)
    const catCheck = await checkCategoryPermission(user.id, user.role, existingRequest.productCategory, 'edit');
    if (!catCheck.allowed) {
      return NextResponse.json(
        { success: false, error: catCheck.reason || 'Bu kategoriye erişim izniniz yok' },
        { status: 403 }
      );
    }

    // Prepare update data
    const updateData: Prisma.ProductionRequestUpdateInput = {};

    if (status !== undefined) {
      updateData.status = status;
    }

    if (producedQuantity !== undefined) {
      updateData.producedQuantity = producedQuantity;
    }

    if (manufacturerNotes !== undefined) {
      updateData.manufacturerNotes = manufacturerNotes;
    }

    if (workflowStage !== undefined) {
      updateData.workflowStage = workflowStage;
    }

    // Update the request
    const updated = await prisma.productionRequest.update({
      where: { id },
      data: updateData,
    });

    await logAction({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'UPDATE_PRODUCTION',
      entityType: 'ProductionRequest',
      entityId: id,
      description: `Üretim güncellendi: ${existingRequest.iwasku} ${existingRequest.productName} (${existingRequest.productCategory}) — durum: ${updated.status}, üretilen: ${updated.producedQuantity ?? '-'}`,
      metadata: { ...updateData, requestId: id, iwasku: existingRequest.iwasku, productName: existingRequest.productName, productCategory: existingRequest.productCategory },
    });

    // Waterfall completion: auto-complete marketplace requests by priority
    if (producedQuantity !== undefined) {
      await waterfallComplete(existingRequest.iwasku, existingRequest.productionMonth);
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    return errorResponse(error, 'Talep güncellenemedi');
  }
}
