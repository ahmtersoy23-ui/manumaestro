/**
 * Audit Logs Page — Server Component
 *
 * Server'da prisma sorgusuyla logs prefetch eder, filter dropdown + refresh
 * Client Component'te kalır. Filter URL searchParams ile sync edilir, böylece
 * filter değişikliği yeni RSC render tetikler (browser navigation pattern).
 */

import { prisma } from '@/lib/db/prisma';
import { AuditLogsClient } from './AuditLogsClient';

interface PageProps {
  searchParams: Promise<{ action?: string }>;
}

const DEFAULT_LIMIT = 50;

export default async function AuditLogsPage({ searchParams }: PageProps) {
  const { action } = await searchParams;

  const where = action ? { action: action as 'CREATE_REQUEST' } : {};
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: DEFAULT_LIMIT,
    include: {
      user: { select: { name: true, email: true, role: true } },
    },
  });

  // Prisma JSON → serializable plain object
  const serializedLogs = logs.map(log => ({
    id: log.id,
    userName: log.userName,
    userEmail: log.userEmail,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    description: log.description,
    metadata: log.metadata as Record<string, unknown> | null,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt.toISOString(),
    user: log.user,
  }));

  return <AuditLogsClient initialLogs={serializedLogs} currentFilter={action ?? ''} />;
}
