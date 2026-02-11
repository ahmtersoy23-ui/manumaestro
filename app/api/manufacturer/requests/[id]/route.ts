/**
 * Update Manufacturer Request API
 * Updates produced quantity, manufacturer notes, and status
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';
import { ManufacturerUpdateSchema, UUIDParamSchema, formatValidationError } from '@/lib/validation/schemas';

const logger = createLogger('Manufacturer Requests API');

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = UUIDParamSchema.safeParse(id);
    if (!idValidation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request ID format',
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
          error: 'Validation failed',
          details: formatValidationError(bodyValidation.error),
        },
        { status: 400 }
      );
    }

    const { producedQuantity, manufacturerNotes, status } = bodyValidation.data;

    // Fetch the request to get quantity
    const existingRequest = await prisma.productionRequest.findUnique({
      where: { id },
      select: { quantity: true },
    });

    if (!existingRequest) {
      return NextResponse.json(
        { error: 'Request not found' },
        { status: 404 }
      );
    }

    // Prepare update data
    const updateData: any = {};

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
    logger.error('Manufacturer request update error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update request',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
