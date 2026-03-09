/**
 * Update Manufacturer Request API
 * Updates produced quantity, manufacturer notes, and status
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ManufacturerUpdateSchema, UUIDParamSchema, formatValidationError } from '@/lib/validation/schemas';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { requireRole, checkMarketplacePermission } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';

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

    // Fetch the request to get quantity and marketplaceId
    const existingRequest = await prisma.productionRequest.findUnique({
      where: { id },
      select: { quantity: true, marketplaceId: true },
    });

    if (!existingRequest) {
      return NextResponse.json(
        { error: 'Talep bulunamadı' },
        { status: 404 }
      );
    }

    // Marketplace permission check for OPERATOR users
    const permCheck = await checkMarketplacePermission(user.id, user.role, existingRequest.marketplaceId, 'edit');
    if (!permCheck.allowed) {
      return NextResponse.json(
        { success: false, error: permCheck.reason || 'Bu talebi güncelleyemezsiniz' },
        { status: 403 }
      );
    }

    // Prepare update data
    const updateData: Prisma.ProductionRequestUpdateInput = {};

    // Handle status change first to check for auto-complete
    if (status !== undefined) {
      updateData.status = status;

      // Auto-set producedQuantity to quantity when status is COMPLETED
      // Only if producedQuantity is not explicitly provided OR is 0/null/empty
      if (status === 'COMPLETED') {
        if (producedQuantity === undefined || producedQuantity === null || producedQuantity === 0) {
          updateData.producedQuantity = existingRequest.quantity;
        } else {
          // User provided a specific value, use that
          updateData.producedQuantity = producedQuantity;
        }
      } else {
        // Not completed, just update producedQuantity if provided
        if (producedQuantity !== undefined) {
          updateData.producedQuantity = producedQuantity;
        }
      }
    } else {
      // No status change, just update producedQuantity if provided
      if (producedQuantity !== undefined) {
        updateData.producedQuantity = producedQuantity;
      }
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

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    return errorResponse(error, 'Talep güncellenemedi');
  }
}
