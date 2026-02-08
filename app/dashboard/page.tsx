/**
 * Dashboard Home Page
 * Month-based view with active and archived months
 */

'use client';

import { useState, useEffect } from 'react';
import { Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { getAvailableMonths, getAllMonthsForViewing, formatMonthValue } from '@/lib/monthUtils';

interface MonthStats {
  month: string;
  totalRequests: number;
  totalQuantity: number;
}

export default function DashboardPage() {
  const [monthStats, setMonthStats] = useState<MonthStats[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);

  const availableMonths = getAvailableMonths();
  const allMonths = getAllMonthsForViewing(6);
  const archivedMonths = allMonths.filter(m => m.locked);

  useEffect(() => {
    async function fetchStats() {
      try {
        // Fetch stats for all months
        const promises = allMonths.map(async (month) => {
          const res = await fetch(`/api/requests/monthly?month=${month.value}`);
          const data = await res.json();

          return {
            month: month.value,
            totalRequests: data.data?.totalRequests || 0,
            totalQuantity: data.data?.totalQuantity || 0,
          };
        });

        const stats = await Promise.all(promises);
        setMonthStats(stats);
      } catch (error) {
        console.error('Failed to fetch month stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  const getStatsForMonth = (monthValue: string) => {
    return monthStats.find(s => s.month === monthValue) || {
      month: monthValue,
      totalRequests: 0,
      totalQuantity: 0,
    };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Production Dashboard</h1>
        <p className="text-gray-600 mt-1">
          Select a month to manage production requests and track manufacturing
        </p>
      </div>

      {/* Active Months */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Active Months
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {availableMonths.map((month) => {
            const stats = getStatsForMonth(month.value);
            return (
              <Link
                key={month.value}
                href={`/dashboard/month/${month.value}`}
                className="block p-6 bg-white rounded-xl border-2 border-gray-200 hover:border-purple-500 hover:shadow-lg transition-all group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
                      <Calendar className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {month.label}
                      </h3>
                      <p className="text-xs text-gray-500">Click to manage</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Requests</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalRequests}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Total Quantity</p>
                    <p className="text-2xl font-bold text-purple-600">{stats.totalQuantity}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Archived Months */}
      {archivedMonths.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-purple-600 transition-colors mb-4"
          >
            Archived Months
            {showArchived ? (
              <ChevronUp className="w-5 h-5" />
            ) : (
              <ChevronDown className="w-5 h-5" />
            )}
            <span className="text-sm font-normal text-gray-600">
              ({archivedMonths.length} months)
            </span>
          </button>

          {showArchived && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {archivedMonths.map((month) => {
                const stats = getStatsForMonth(month.value);
                return (
                  <Link
                    key={month.value}
                    href={`/dashboard/month/${month.value}`}
                    className="block p-6 bg-gray-50 rounded-xl border-2 border-gray-200 hover:border-gray-400 hover:shadow-md transition-all group"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-gray-200 rounded-lg group-hover:bg-gray-300 transition-colors">
                          <Calendar className="w-6 h-6 text-gray-600" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {month.label}
                          </h3>
                          <p className="text-xs text-gray-500">View only</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-200">
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Requests</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.totalRequests}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Total Quantity</p>
                        <p className="text-2xl font-bold text-gray-600">{stats.totalQuantity}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
