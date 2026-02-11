/**
 * Workflow API
 * PATCH: Update workflow stage of a production request
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('Workflow API');
import { WorkflowStage } from '@prisma/client';
import { logAction } from '@/lib/auditLog';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { requestId, workflowStage } = body;

    // Validation
    if (!requestId || !workflowStage) {
      return NextResponse.json(
        { error: 'Request ID and workflow stage are required' },
        { status: 400 }
      );
    }

    // Validate workflow stage
    const validStages = Object.values(WorkflowStage);
    if (!validStages.includes(workflowStage)) {
      return NextResponse.json(
        { error: 'Invalid workflow stage' },
        { status: 400 }
      );
    }

    // Get the request
    const request_data = await prisma.productionRequest.findUnique({
      where: { id: requestId },
      include: {
        marketplace: true,
        enteredBy: true,
      },
    });

    if (!request_data) {
      return NextResponse.json(
        { error: 'Request not found' },
        { status: 404 }
      );
    }

    // Update workflow stage
    const updatedRequest = await prisma.productionRequest.update({
      where: { id: requestId },
      data: {
        workflowStage: workflowStage as WorkflowStage,
        updatedAt: new Date(),
      },
      include: {
        marketplace: true,
      },
    });

    // Log action
    await logAction({
      userId: request_data.enteredById,
      userName: request_data.enteredBy.name,
      userEmail: request_data.enteredBy.email,
      action: 'UPDATE_PRODUCTION',
      entityType: 'ProductionRequest',
      entityId: requestId,
      description: `Moved ${request_data.productName} to ${workflowStage.replace(/_/g, ' ')}`,
      metadata: {
        previousStage: request_data.workflowStage,
        newStage: workflowStage,
        category: request_data.productCategory,
      },
    });

    return NextResponse.json({
      success: true,
      data: updatedRequest,
    });
  } catch (error) {
    logger.error('Update workflow stage error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update workflow stage',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
