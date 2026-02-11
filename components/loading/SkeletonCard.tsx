/**
 * Skeleton Loading Components
 * Provides skeleton screens for better loading UX
 */

'use client';

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
      <div className="h-8 bg-gray-300 rounded w-1/2"></div>
    </div>
  );
}

export function SkeletonTable() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Table Header */}
      <div className="bg-gray-50 p-4 border-b border-gray-200">
        <div className="grid grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-4 bg-gray-200 rounded animate-pulse"></div>
          ))}
        </div>
      </div>

      {/* Table Rows */}
      {[...Array(5)].map((_, rowIndex) => (
        <div key={rowIndex} className="p-4 border-b border-gray-100">
          <div className="grid grid-cols-5 gap-4">
            {[...Array(5)].map((_, colIndex) => (
              <div
                key={colIndex}
                className="h-6 bg-gray-100 rounded animate-pulse"
                style={{ animationDelay: `${rowIndex * 100 + colIndex * 50}ms` }}
              ></div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonList() {
  return (
    <div className="space-y-3">
      {[...Array(8)].map((_, index) => (
        <div
          key={index}
          className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse"
          style={{ animationDelay: `${index * 75}ms` }}
        >
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="h-5 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-gray-100 rounded w-1/2"></div>
            </div>
            <div className="h-8 w-20 bg-gray-200 rounded"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonStats() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {[...Array(3)].map((_, index) => (
        <div
          key={index}
          className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse"
          style={{ animationDelay: `${index * 100}ms` }}
        >
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-3"></div>
          <div className="h-8 bg-gray-300 rounded w-2/3"></div>
        </div>
      ))}
    </div>
  );
}
