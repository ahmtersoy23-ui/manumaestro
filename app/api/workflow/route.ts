/**
 * Workflow API
 * PATCH: Update workflow stage of a production request
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { rateLimiters, rateLimitExceededResponse } from '@/lib/middleware/rateLimit';
import { WorkflowStage } from '@prisma/client';
import { logAction } from '@/lib/auditLog';
import { requireRole } from '@/lib/auth/verify';
import { errorResponse } from '@/lib/api/response';

export async function PATCH(request: NextRequest) {
  try {
    // Rate limiting: 100 requests per minute for write operations
    const rateLimitResult = await rateLimiters.write.check(request, 'update-workflow');
    if (!rateLimitResult.success) {
      return rateLimitExceededResponse(rateLimitResult);
    }

    // Authentication & Authorization: Require editor or admin role
    const authResult = await requireRole(request, ['admin', 'editor']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

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

    // Log action with authenticated user (who performed the update)
    await logAction({
      userId: user.id,           // User who PERFORMED the update
      userName: user.name,
      userEmail: user.email,
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
    return errorResponse(error, 'Failed to update workflow stage');
  }
}
