/**
 * Audit Log Utility
 * Centralized function for logging user actions
 */

import { prisma } from '@/lib/db/prisma';
import { AuditAction } from '@prisma/client';

interface LogActionParams {
  userId: string;
  userName: string;
  userEmail: string;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  description: string;
  metadata?: any;
  ipAddress?: string;
}

export async function logAction(params: LogActionParams) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        userName: params.userName,
        userEmail: params.userEmail,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        description: params.description,
        metadata: params.metadata,
        ipAddress: params.ipAddress,
      },
    });
  } catch (error) {
    // Don't throw errors for logging failures - just log them
    console.error('Failed to create audit log:', error);
  }
}
