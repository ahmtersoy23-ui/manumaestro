/**
 * Production Request DELETE API
 * DELETE: Delete a specific request
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Request ID is required' },
        { status: 400 }
      );
    }

    // Delete the production request
    await prisma.productionRequest.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: 'Request deleted successfully',
    });
  } catch (error) {
    console.error('Delete request error:', error);

    // Check if it's a "not found" error
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      return NextResponse.json(
        {
          success: false,
          error: 'Request not found',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete request',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
