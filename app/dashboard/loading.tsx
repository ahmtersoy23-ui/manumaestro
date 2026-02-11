/**
 * Dashboard Loading State
 * Displayed automatically by Next.js during navigation
 */

import { SkeletonStats, SkeletonTable } from '@/components/loading/SkeletonCard';

export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      {/* Page Header Skeleton */}
      <div>
        <div className="h-8 bg-gray-200 rounded w-1/3 mb-2 animate-pulse"></div>
        <div className="h-4 bg-gray-100 rounded w-1/2 animate-pulse"></div>
      </div>

      {/* Stats Cards Skeleton */}
      <SkeletonStats />

      {/* Table Skeleton */}
      <SkeletonTable />
    </div>
  );
}
