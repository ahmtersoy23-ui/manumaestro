/**
 * Badge — rozet/chip primitive'i.
 *
 * İki kullanım:
 *  1) Önceden tanımlı stil ile:
 *       <Badge className={PRIORITY_STYLE[p]}>{PRIORITY_LABEL[p]}</Badge>
 *  2) Hazır yardımcılar (lib/ui/badges.ts ile birlikte):
 *       <PriorityBadge priority={req.priority} />
 *       <StatusBadge status={req.status} />
 */
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import {
  PRIORITY_STYLE,
  PRIORITY_LABEL,
  STATUS_STYLE,
  STATUS_LABEL,
  FALLBACK_BADGE,
  type Priority,
  type RequestStatus,
} from '@/lib/ui/badges';

interface BadgeProps {
  children: ReactNode;
  className?: string;
}

export function Badge({ children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const key = priority as Priority;
  return <Badge className={PRIORITY_STYLE[key] ?? FALLBACK_BADGE}>{PRIORITY_LABEL[key] ?? priority}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const key = status as RequestStatus;
  return <Badge className={STATUS_STYLE[key] ?? FALLBACK_BADGE}>{STATUS_LABEL[key] ?? status}</Badge>;
}
