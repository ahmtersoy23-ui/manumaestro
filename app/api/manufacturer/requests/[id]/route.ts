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
      select: { iwasku: true, productName: true, quantity: true, productCategory: true, productionMonth: true, producedQuantity: true, status: true },
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

    // Prepare update data (per-request fields only)
    const updateData: Prisma.ProductionRequestUpdateInput = {};

    if (status !== undefined && status !== existingRequest.status) {
      updateData.status = status;
    }
    if (manufacturerNotes !== undefined) {
      updateData.manufacturerNotes = manufacturerNotes;
    }
    if (workflowStage !== undefined) {
      updateData.workflowStage = workflowStage;
    }

    // producedQuantity → MonthSnapshot.produced (product-level, handled below)
    // Check if anything actually changed on this request
    const hasRequestChanges = Object.keys(updateData).length > 0;

    if (hasRequestChanges) {
      const updated = await prisma.productionRequest.update({
        where: { id },
        data: updateData,
      });

      await logAction({
        userId: user.id, userName: user.name, userEmail: user.email,
        action: 'UPDATE_PRODUCTION', entityType: 'ProductionRequest', entityId: id,
        description: `Üretim güncellendi: ${existingRequest.iwasku} ${existingRequest.productName} (${existingRequest.productCategory}) — durum: ${updated.status}, üretilen: ${updated.producedQuantity ?? '-'}`,
        metadata: { ...updateData, requestId: id, iwasku: existingRequest.iwasku },
      });
    }

    // Write producedQuantity to MonthSnapshot.produced (product-level single value)
    if (producedQuantity !== undefined) {
      const existing = await prisma.monthSnapshot.findUnique({
        where: { month_iwasku: { month: existingRequest.productionMonth, iwasku: existingRequest.iwasku } },
      });

      if (!existing || existing.produced !== producedQuantity) {
        await prisma.monthSnapshot.upsert({
          where: { month_iwasku: { month: existingRequest.productionMonth, iwasku: existingRequest.iwasku } },
          update: { produced: producedQuantity },
          create: {
            month: existingRequest.productionMonth,
            iwasku: existingRequest.iwasku,
            totalRequested: existingRequest.quantity,
            warehouseStock: 0,
            netProduction: existingRequest.quantity,
            produced: producedQuantity,
          },
        });
      }

      // Waterfall'ı her save'de çağır — producedQuantity değişmese bile DB'de eski PARTIALLY/REQUESTED
      // kayıtlar varsa (warehouseStock veya totalRequested değişmiş olabilir) tutarlı hale getirir.
      await waterfallComplete(existingRequest.iwasku, existingRequest.productionMonth);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, 'Talep güncellenemedi');
  }
}
