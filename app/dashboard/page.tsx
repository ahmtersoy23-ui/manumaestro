/**
 * Dashboard Home Page
 * Month-based view with active and archived months
 */

'use client';

import { useState, useEffect } from 'react';
import { Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { getActiveMonths, getAllMonthsForViewing, formatMonthValue } from '@/lib/monthUtils';

interface MonthStats {
  month: string;
  totalRequests: number;
  totalQuantity: number;
  totalProduced: number;
  totalDesi: number;
  totalProducedDesi: number;
  itemsWithoutSize: number;
}

export default function DashboardPage() {
  const [monthStats, setMonthStats] = useState<MonthStats[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);

  const availableMonths = getActiveMonths();
  const allMonths = getAllMonthsForViewing(6);

  // Archived months: only months BEFORE the oldest active month, maximum 6 months
  const oldestActiveMonth = availableMonths[0].value;
  const archivedMonths = allMonths
    .filter(m => m.value < oldestActiveMonth)
    .slice(0, 6);

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
            totalProduced: data.data?.totalProduced || 0,
            totalDesi: data.data?.totalDesi || 0,
            totalProducedDesi: data.data?.totalProducedDesi || 0,
            itemsWithoutSize: data.data?.itemsWithoutSize || 0,
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
      totalProduced: 0,
      totalDesi: 0,
      totalProducedDesi: 0,
      itemsWithoutSize: 0,
    };
  };

  // Calculate overall production summary for active months
  const activeMonthsStats = monthStats.filter(stat =>
    availableMonths.some(m => m.value === stat.month)
  );

  const overallSummary = activeMonthsStats.reduce(
    (acc, stat) => ({
      totalRequests: acc.totalRequests + stat.totalRequests,
      totalQuantity: acc.totalQuantity + stat.totalQuantity,
      totalProduced: acc.totalProduced + stat.totalProduced,
      totalDesi: acc.totalDesi + stat.totalDesi,
      totalProducedDesi: acc.totalProducedDesi + stat.totalProducedDesi,
      itemsWithoutSize: acc.itemsWithoutSize + stat.itemsWithoutSize,
    }),
    { totalRequests: 0, totalQuantity: 0, totalProduced: 0, totalDesi: 0, totalProducedDesi: 0, itemsWithoutSize: 0 }
  );

  const completionRate = overallSummary.totalQuantity > 0
    ? Math.round((overallSummary.totalProduced / overallSummary.totalQuantity) * 100)
    : 0;

  const desiCompletionRate = overallSummary.totalDesi > 0
    ? Math.round((overallSummary.totalProducedDesi / overallSummary.totalDesi) * 100)
    : 0;

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

      {/* Overall Production Summary */}
      {overallSummary.totalRequests > 0 && (
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 rounded-xl p-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Overall Production Summary</h2>
            {overallSummary.itemsWithoutSize > 0 && (
              <div className="bg-yellow-500/20 px-3 py-1 rounded-full text-sm">
                ⚠️ {overallSummary.itemsWithoutSize} items missing desi data
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-purple-100 text-sm mb-1">Total Requests</p>
              <p className="text-3xl font-bold">{overallSummary.totalRequests}</p>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-purple-100 text-sm mb-1">Requested</p>
              <p className="text-2xl font-bold">{overallSummary.totalQuantity} adet</p>
              <p className="text-2xl font-bold mt-1">{Math.round(overallSummary.totalDesi)} desi</p>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-purple-100 text-sm mb-1">Produced</p>
              <p className="text-2xl font-bold">{overallSummary.totalProduced} adet</p>
              <p className="text-2xl font-bold mt-1">{Math.round(overallSummary.totalProducedDesi)} desi</p>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-purple-100 text-sm mb-1">Completion Rate</p>
              <p className="text-2xl font-bold">{completionRate}% (adet)</p>
              <p className="text-2xl font-bold mt-1">{desiCompletionRate}% (desi)</p>
              <div className="w-full bg-white/20 rounded-full h-2 mt-2">
                <div
                  className="bg-white h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(completionRate, 100)}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      )}

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
