/**
 * Dashboard Home Page
 * Month-based view with active and archived months
 */

'use client';

import { useState, useEffect } from 'react';
import { Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { getActiveMonths, getAllMonthsForViewing, formatMonthValue } from '@/lib/monthUtils';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DashboardPage');

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
        // Fetch stats for all months in a single batch request
        const monthValues = allMonths.map(m => m.value).join(',');
        const res = await fetch(`/api/dashboard/stats?months=${monthValues}`);
        const data = await res.json();

        if (data.success && Array.isArray(data.data)) {
          setMonthStats(data.data);
        }
      } catch (error) {
        logger.error('Failed to fetch month stats:', error);
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
          <p className="text-gray-600">Yükleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Üretim Paneli</h1>
        <p className="text-gray-600 mt-1">
          Üretim taleplerini yönetmek ve üretimi takip etmek için bir ay seçin
        </p>
      </div>

      {/* Active Months */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Aktif Aylar
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
                      <p className="text-xs text-gray-500">Yönetmek için tıklayın</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Talep</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalRequests}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Toplam Miktar</p>
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
            Arşiv Aylar
            {showArchived ? (
              <ChevronUp className="w-5 h-5" />
            ) : (
              <ChevronDown className="w-5 h-5" />
            )}
            <span className="text-sm font-normal text-gray-600">
              ({archivedMonths.length} ay)
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
                          <p className="text-xs text-gray-500">Sadece görüntüle</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-200">
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Talep</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.totalRequests}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Toplam Miktar</p>
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
