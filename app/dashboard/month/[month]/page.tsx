/**
 * Month Detail Page
 * Shows both categories (for production) and marketplaces (for request entry)
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Calendar, Package, ShoppingCart, Factory, ArrowLeft } from 'lucide-react';
import { parseMonthValue, isMonthLocked } from '@/lib/monthUtils';

interface CategorySummary {
  productCategory: string;
  totalQuantity: number;
  totalProduced: number;
  totalDesi: number;
  producedDesi: number;
  requestCount: number;
  itemsWithoutSize: number;
}

interface MarketplaceSummary {
  marketplaceId: string;
  marketplaceName: string;
  totalQuantity: number;
  requestCount: number;
}

interface Marketplace {
  id: string;
  name: string;
  code: string;
  region: string;
  marketplaceType: string;
  colorTag: string | null;
}

const marketplaceSlugMap: Record<string, string> = {
  'AMZN_US': 'amzn-us',
  'AMZN_EU': 'amzn-eu',
  'AMZN_UK': 'amzn-uk',
  'AMZN_CA': 'amzn-ca',
  'AMZN_AU': 'amzn-au',
  'WAYFAIR_US': 'wayfair-us',
  'WAYFAIR_UK': 'wayfair-uk',
  'TAKEALOT_ZA': 'takealot-za',
  'BOL_NL': 'bol-nl',
};

export default function MonthDetailPage() {
  const params = useParams();
  const month = params.month as string;

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [marketplaces, setMarketplaces] = useState<MarketplaceSummary[]>([]);
  const [allMarketplaces, setAllMarketplaces] = useState<Marketplace[]>([]);
  const [monthStats, setMonthStats] = useState({ totalRequests: 0, totalQuantity: 0, totalDesi: 0, itemsWithoutSize: 0 });
  const [viewMode, setViewMode] = useState<'quantity' | 'desi'>('quantity');

  const monthDate = parseMonthValue(month);
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const isLocked = isMonthLocked(month);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Fetch ALL marketplaces
        const mpRes = await fetch('/api/marketplaces');
        const mpData = await mpRes.json();

        if (mpData.success) {
          setAllMarketplaces(mpData.data);
        }

        // Fetch monthly summary
        const res = await fetch(`/api/requests/monthly?month=${month}`);
        const data = await res.json();

        if (data.success) {
          setMonthStats({
            totalRequests: data.data.totalRequests || 0,
            totalQuantity: data.data.totalQuantity || 0,
            totalDesi: data.data.totalDesi || 0,
            itemsWithoutSize: data.data.itemsWithoutSize || 0,
          });

          // Group by category
          const categoryMap = new Map<string, CategorySummary>();
          data.data.summary?.forEach((item: any) => {
            const existing = categoryMap.get(item.productCategory);
            if (existing) {
              existing.totalQuantity += item.totalQuantity;
              existing.totalProduced += item.totalProduced || 0;
              existing.totalDesi += item.totalDesi || 0;
              existing.producedDesi += item.producedDesi || 0;
              existing.requestCount += item.requestCount;
              existing.itemsWithoutSize += item.itemsWithoutSize || 0;
            } else {
              categoryMap.set(item.productCategory, {
                productCategory: item.productCategory,
                totalQuantity: item.totalQuantity,
                totalProduced: item.totalProduced || 0,
                totalDesi: item.totalDesi || 0,
                producedDesi: item.producedDesi || 0,
                requestCount: item.requestCount,
                itemsWithoutSize: item.itemsWithoutSize || 0,
              });
            }
          });

          setCategories(Array.from(categoryMap.values()).sort((a, b) =>
            b.totalQuantity - a.totalQuantity
          ));

          // Marketplace summary - create a map for quick lookup
          const marketplaceDataMap = new Map<string, MarketplaceSummary>();
          data.data.summary?.forEach((item: any) => {
            const key = item.marketplaceId || item.marketplaceName;
            const existing = marketplaceDataMap.get(key);
            if (existing) {
              existing.totalQuantity += item.totalQuantity;
              existing.requestCount += item.requestCount;
            } else {
              marketplaceDataMap.set(key, {
                marketplaceId: item.marketplaceId,
                marketplaceName: item.marketplaceName,
                totalQuantity: item.totalQuantity,
                requestCount: item.requestCount,
              });
            }
          });

          setMarketplaces(Array.from(marketplaceDataMap.values()));
        }
      } catch (error) {
        console.error('Failed to fetch month data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [month]);

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
      {/* Back Button */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>

      {/* Month Header */}
      <div className="bg-gradient-to-r from-purple-600 to-purple-700 rounded-xl p-8 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-8 h-8" />
            <h1 className="text-3xl font-bold">{monthLabel}</h1>
            {isLocked && (
              <span className="px-3 py-1 bg-white/20 rounded-full text-sm">
                View Only
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('quantity')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                viewMode === 'quantity'
                  ? 'bg-white text-purple-700'
                  : 'bg-white/20 text-white hover:bg-white/30'
              }`}
            >
              Adet
            </button>
            <button
              onClick={() => setViewMode('desi')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                viewMode === 'desi'
                  ? 'bg-white text-purple-700'
                  : 'bg-white/20 text-white hover:bg-white/30'
              }`}
            >
              Desi
            </button>
          </div>
        </div>

        {monthStats.itemsWithoutSize > 0 && (
          <div className="bg-yellow-500/20 px-4 py-2 rounded-lg text-sm mb-4">
            ⚠️ {monthStats.itemsWithoutSize} items missing desi data
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <div className="bg-white/10 rounded-lg p-4">
            <p className="text-purple-100 text-sm mb-1">Total Requests</p>
            <p className="text-4xl font-bold">{monthStats.totalRequests}</p>
          </div>
          <div className="bg-white/10 rounded-lg p-4">
            <p className="text-purple-100 text-sm mb-1">
              Total {viewMode === 'quantity' ? 'Quantity' : 'Desi'}
            </p>
            <p className="text-4xl font-bold">
              {viewMode === 'quantity'
                ? monthStats.totalQuantity
                : Math.round(monthStats.totalDesi)}
            </p>
          </div>
        </div>
      </div>

      {/* Categories Section - Production Tracking */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Factory className="w-6 h-6 text-gray-700" />
          <h2 className="text-2xl font-semibold text-gray-900">
            Production by Category
          </h2>
        </div>
        <p className="text-gray-600 mb-6">
          Track production progress and enter manufactured quantities
        </p>

        {categories.length === 0 ? (
          <div className="bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 p-12 text-center">
            <Factory className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">No production requests for this month</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((category) => (
              <Link
                key={category.productCategory}
                href={`/dashboard/manufacturer/${encodeURIComponent(category.productCategory)}?month=${month}`}
                className="block p-6 bg-white rounded-xl border-2 border-gray-200 hover:border-orange-500 hover:shadow-lg transition-all group"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-orange-100 rounded-lg group-hover:bg-orange-200 transition-colors">
                    <Package className="w-6 h-6 text-orange-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {category.productCategory}
                  </h3>
                </div>

                <div className="space-y-3 mt-4 pt-4 border-t border-gray-100">
                  {/* Items count */}
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-gray-600">Items</p>
                    <p className="text-sm font-bold text-gray-900">{category.requestCount}</p>
                  </div>

                  {/* Warning for missing desi */}
                  {viewMode === 'desi' && category.itemsWithoutSize > 0 && (
                    <div className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded">
                      ⚠️ {category.itemsWithoutSize} items without desi
                    </div>
                  )}

                  {/* Requested */}
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-gray-600">Requested</p>
                    <p className="text-sm font-bold text-orange-600">
                      {viewMode === 'quantity'
                        ? `${category.totalQuantity} adet`
                        : `${Math.round(category.totalDesi)} desi`}
                    </p>
                  </div>

                  {/* Produced */}
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-gray-600">Produced</p>
                    <p className="text-sm font-bold text-green-600">
                      {viewMode === 'quantity'
                        ? `${category.totalProduced} adet`
                        : `${Math.round(category.producedDesi)} desi`}
                    </p>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-xs text-gray-600">Progress</p>
                      <p className="text-xs font-semibold text-gray-900">
                        {viewMode === 'quantity'
                          ? (category.totalQuantity > 0
                              ? Math.round((category.totalProduced / category.totalQuantity) * 100)
                              : 0)
                          : (category.totalDesi > 0
                              ? Math.round((category.producedDesi / category.totalDesi) * 100)
                              : 0)}%
                      </p>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-orange-500 to-green-500 h-2 rounded-full transition-all"
                        style={{
                          width: `${viewMode === 'quantity'
                            ? (category.totalQuantity > 0
                                ? Math.min((category.totalProduced / category.totalQuantity) * 100, 100)
                                : 0)
                            : (category.totalDesi > 0
                                ? Math.min((category.producedDesi / category.totalDesi) * 100, 100)
                                : 0)}%`
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Marketplaces Section - Request Entry */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <ShoppingCart className="w-6 h-6 text-gray-700" />
          <h2 className="text-2xl font-semibold text-gray-900">
            Marketplaces
          </h2>
        </div>
        <p className="text-gray-600 mb-6">
          Enter new production requests for each marketplace
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allMarketplaces.map((mp) => {
            // Find if this marketplace has requests for this month
            const summary = marketplaces.find(m => m.marketplaceId === mp.id);
            const requestCount = summary?.requestCount || 0;
            const totalQuantity = summary?.totalQuantity || 0;

            // Get slug from code
            const slug = marketplaceSlugMap[mp.code] || mp.code.toLowerCase().replace('_', '-');

            return (
              <Link
                key={mp.id}
                href={`/dashboard/marketplace/${slug}`}
                className="block p-6 bg-white rounded-xl border-2 border-gray-200 hover:border-purple-500 hover:shadow-lg transition-all group"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
                      <ShoppingCart className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {mp.name}
                      </h3>
                      <p className="text-xs text-gray-500">{mp.region}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Requests</p>
                    <p className={`text-xl font-bold ${requestCount > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                      {requestCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Quantity</p>
                    <p className={`text-xl font-bold ${totalQuantity > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                      {totalQuantity}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
