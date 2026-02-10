/**
 * Update Manufacturer Request API
 * Updates produced quantity, manufacturer notes, and status
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { producedQuantity, manufacturerNotes, status } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Request ID is required' },
        { status: 400 }
      );
    }

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
    if (producedQuantity !== undefined) {
      updateData.producedQuantity = producedQuantity;
    }
    if (manufacturerNotes !== undefined) {
      updateData.manufacturerNotes = manufacturerNotes;
    }
    if (status !== undefined) {
      updateData.status = status;

      // Auto-set producedQuantity to quantity when status is COMPLETED
      if (status === 'COMPLETED' && producedQuantity === undefined) {
        updateData.producedQuantity = existingRequest.quantity;
      }
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
    console.error('Manufacturer request update error:', error);
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
