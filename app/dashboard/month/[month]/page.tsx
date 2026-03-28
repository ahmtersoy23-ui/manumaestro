/**
 * Month Detail Page
 * Shows both categories (for production) and marketplaces (for request entry)
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Calendar, Package, ShoppingCart, Factory, ArrowLeft, Plus, ChevronDown, ChevronUp, Warehouse, Pencil, Hammer, Sofa, ShoppingBag, Camera } from 'lucide-react';
import { parseMonthValue, isMonthLocked } from '@/lib/monthUtils';
import { useAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MonthDetailPage');
import { AddMarketplaceModal } from '@/components/modals/AddMarketplaceModal';

// Production group classification
const HAZIR_ALIM_CATEGORIES = ['Alsat', 'Tekstil'];
const MOBILYA_CATEGORIES = ['Mobilya'];

type ProductionGroup = 'fabrika' | 'mobilya' | 'hazirAlim';

function getProductionGroup(categoryName: string): ProductionGroup {
  if (HAZIR_ALIM_CATEGORIES.includes(categoryName)) return 'hazirAlim';
  if (MOBILYA_CATEGORIES.includes(categoryName)) return 'mobilya';
  return 'fabrika';
}

const PRODUCTION_GROUPS = [
  { key: 'fabrika' as const, label: 'IWA Fabrika', icon: Hammer, color: 'orange' },
  { key: 'mobilya' as const, label: 'CİTİ Mobilya', icon: Sofa, color: 'blue' },
  { key: 'hazirAlim' as const, label: 'Hazır Alım', icon: ShoppingBag, color: 'emerald' },
];

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
  totalDesi: number;
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

interface MissingDesiItem {
  productName: string;
  productCategory: string;
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
  const { role } = useAuth();

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [marketplaces, setMarketplaces] = useState<MarketplaceSummary[]>([]);
  const [allMarketplaces, setAllMarketplaces] = useState<Marketplace[]>([]);
  const [monthStats, setMonthStats] = useState({ totalRequests: 0, totalQuantity: 0, totalDesi: 0, itemsWithoutSize: 0 });
  const [viewMode, setViewMode] = useState<'quantity' | 'desi'>('quantity');
  const [showMissingItems, setShowMissingItems] = useState(false);
  const [missingDesiItems, setMissingDesiItems] = useState<MissingDesiItem[]>([]);
  const [showAddMarketplaceModal, setShowAddMarketplaceModal] = useState(false);
  const [editMarketplace, setEditMarketplace] = useState<{ id: string; name: string; region: string } | null>(null);
  const [refreshMarketplaces, setRefreshMarketplaces] = useState(0);

  // Snapshot state
  interface SnapshotItem {
    iwasku: string;
    productName: string;
    productCategory: string;
    totalRequested: number;
    warehouseStock: number;
    netProduction: number;
    desi: number | null;
  }
  const [snapshotData, setSnapshotData] = useState<{
    summary: { totalRequested: number; totalStock: number; totalNet: number };
    snapshots: SnapshotItem[];
  } | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotGenerating, setSnapshotGenerating] = useState(false);

  // Derive per-category stock info from snapshot
  interface CategoryStock {
    coveredQty: number;   // min(stock, requested) per product, summed
    coveredDesi: number;
    netQty: number;       // max(0, requested - stock) per product, summed
    netDesi: number;
  }
  const categoryStockMap = new Map<string, CategoryStock>();
  if (snapshotData) {
    for (const s of snapshotData.snapshots) {
      const existing = categoryStockMap.get(s.productCategory) || { coveredQty: 0, coveredDesi: 0, netQty: 0, netDesi: 0 };
      const covered = Math.min(s.warehouseStock, s.totalRequested);
      const net = Math.max(0, s.totalRequested - s.warehouseStock);
      const desiPerUnit = s.desi || 0;
      existing.coveredQty += covered;
      existing.coveredDesi += covered * desiPerUnit;
      existing.netQty += net;
      existing.netDesi += net * desiPerUnit;
      categoryStockMap.set(s.productCategory, existing);
    }
  }

  const monthDate = parseMonthValue(month);
  const monthLabel = monthDate.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  const isLocked = isMonthLocked(month);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Fetch marketplaces and monthly summary in parallel
        const [mpRes, res] = await Promise.all([
          fetch('/api/marketplaces'),
          fetch(`/api/requests/monthly?month=${month}`),
        ]);
        const [mpData, data] = await Promise.all([mpRes.json(), res.json()]);

        if (mpData.success) {
          setAllMarketplaces(mpData.data);
        }

        if (data.success) {
          setMonthStats({
            totalRequests: data.data.totalRequests || 0,
            totalQuantity: data.data.totalQuantity || 0,
            totalDesi: data.data.totalDesi || 0,
            itemsWithoutSize: data.data.itemsWithoutSize || 0,
          });

          setMissingDesiItems(data.data.missingDesiItems || []);

          // API now returns already grouped by category (simplified)
          const categories: CategorySummary[] = (data.data.summary || []).map((item: CategorySummary) => ({
            productCategory: item.productCategory,
            totalQuantity: item.totalQuantity || 0,
            totalProduced: item.totalProduced || 0,
            totalDesi: item.totalDesi || 0,
            producedDesi: item.producedDesi || 0,
            requestCount: item.requestCount || 0,
            itemsWithoutSize: item.itemsWithoutSize || 0,
          }));

          setCategories(categories.sort((a: CategorySummary, b: CategorySummary) => b.totalQuantity - a.totalQuantity));

          // Use marketplace summary directly from API
          const marketplaceSummary: MarketplaceSummary[] = (data.data.marketplaceSummary || []).map((item: MarketplaceSummary) => ({
            marketplaceId: item.marketplaceId,
            marketplaceName: item.marketplaceName,
            totalQuantity: item.totalQuantity || 0,
            totalDesi: item.totalDesi || 0,
            requestCount: item.requestCount || 0,
          }));

          setMarketplaces(marketplaceSummary);
        }
      } catch (error) {
        logger.error('Failed to fetch month data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [month, refreshMarketplaces]);

  // Fetch snapshot data
  useEffect(() => {
    async function fetchSnapshot() {
      try {
        const res = await fetch(`/api/month-snapshot?month=${month}`);
        const data = await res.json();
        if (data.success && data.data.snapshots?.length > 0) {
          setSnapshotData({
            summary: data.data.summary,
            snapshots: data.data.snapshots,
          });
        } else {
          setSnapshotData(null);
        }
      } catch (error) {
        logger.error('Failed to fetch snapshot:', error);
      }
    }
    fetchSnapshot();
  }, [month]);

  const handleGenerateSnapshot = async () => {
    if (!confirm(`${month} ayı için depo snapshot'ı alınsın mı? Mevcut snapshot varsa güncellenecek.`)) return;
    setSnapshotGenerating(true);
    try {
      const res = await fetch('/api/month-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`${data.data.message}`);
        // Refresh snapshot data
        const snapRes = await fetch(`/api/month-snapshot?month=${month}`);
        const snapData = await snapRes.json();
        if (snapData.success && snapData.data.snapshots.length > 0) {
          setSnapshotData({
            summary: snapData.data.summary,
            snapshots: snapData.data.snapshots,
          });
        }
      } else {
        alert(data.error || 'Snapshot alınamadı');
      }
    } catch (error) {
      logger.error('Snapshot generation failed:', error);
      alert('Snapshot alınamadı');
    } finally {
      setSnapshotGenerating(false);
    }
  };

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
      {/* Back Button */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Panele Dön
      </Link>

      {/* Month Header */}
      <div className="bg-gradient-to-b from-slate-50 to-white rounded-2xl border border-slate-200/60 shadow-sm p-5 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <Calendar className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">{monthLabel}</h1>
              {isLocked && (
                <span className="text-xs text-slate-400">Sadece Görüntüle</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 bg-slate-100/80 rounded-lg p-1">
            <button
              onClick={() => setViewMode('quantity')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                viewMode === 'quantity'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Adet
            </button>
            <button
              onClick={() => setViewMode('desi')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                viewMode === 'desi'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Desi
            </button>
          </div>
        </div>

        {monthStats.itemsWithoutSize > 0 && (
          <div className="mb-6">
            <button
              onClick={() => setShowMissingItems(!showMissingItems)}
              className="w-full bg-orange-50/80 border border-orange-200/60 px-4 py-2 rounded-lg text-sm text-orange-700 hover:bg-orange-50 transition-colors flex items-center justify-between"
            >
              <span>{monthStats.itemsWithoutSize} üründe desi bilgisi eksik</span>
              <span className="text-orange-400">{showMissingItems ? '▼' : '▶'}</span>
            </button>
            {showMissingItems && (
              <div className="mt-2 bg-orange-50/50 border border-orange-200/40 px-4 py-3 rounded-lg text-sm space-y-2">
                {missingDesiItems.map((item, index) => (
                  <div key={index} className="py-1 border-b border-orange-100 last:border-0">
                    <div className="font-medium text-slate-800">{item.productName}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{item.productCategory}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Summary cards */}
        {(() => {
          const hasStock = categoryStockMap.size > 0;
          const totalStock = hasStock ? Array.from(categoryStockMap.values()).reduce((s, c) => ({ coveredQty: s.coveredQty + c.coveredQty, coveredDesi: s.coveredDesi + c.coveredDesi, netQty: s.netQty + c.netQty, netDesi: s.netDesi + c.netDesi }), { coveredQty: 0, coveredDesi: 0, netQty: 0, netDesi: 0 }) : null;
          return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl p-5 border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Toplam Talep</p>
                <p className="text-4xl font-bold text-slate-900 tabular-nums">{monthStats.totalRequests}</p>
              </div>
              <div className="bg-white rounded-xl p-5 border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                {hasStock && totalStock ? (
                  <>
                    <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Net İhtiyaç</p>
                    <p className="text-4xl font-bold text-slate-900 tabular-nums">
                      {viewMode === 'quantity' ? totalStock.netQty.toLocaleString('tr-TR') : Math.round(totalStock.netDesi).toLocaleString('tr-TR')}
                      <span className="text-lg font-normal text-slate-400 ml-1.5">{viewMode === 'quantity' ? 'adet' : 'desi'}</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-2">
                      Talep {viewMode === 'quantity' ? monthStats.totalQuantity.toLocaleString('tr-TR') : Math.round(monthStats.totalDesi).toLocaleString('tr-TR')} · Depo {viewMode === 'quantity' ? totalStock.coveredQty.toLocaleString('tr-TR') : Math.round(totalStock.coveredDesi).toLocaleString('tr-TR')}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Toplam {viewMode === 'quantity' ? 'Miktar' : 'Desi'}</p>
                    <p className="text-4xl font-bold text-slate-900 tabular-nums">
                      {viewMode === 'quantity' ? monthStats.totalQuantity.toLocaleString('tr-TR') : Math.round(monthStats.totalDesi).toLocaleString('tr-TR')}
                    </p>
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* Production group breakdown */}
        {categories.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mt-4">
            {PRODUCTION_GROUPS.map((group) => {
              const groupCats = categories.filter(c => getProductionGroup(c.productCategory) === group.key);
              const totalQty = groupCats.reduce((s, c) => s + c.totalQuantity, 0);
              const totalDesi = groupCats.reduce((s, c) => s + c.totalDesi, 0);
              if (totalQty === 0 && totalDesi === 0) return null;
              const groupStock = groupCats.reduce((acc, c) => {
                const cs = categoryStockMap.get(c.productCategory);
                if (cs) { acc.coveredQty += cs.coveredQty; acc.coveredDesi += cs.coveredDesi; acc.netQty += cs.netQty; acc.netDesi += cs.netDesi; }
                return acc;
              }, { coveredQty: 0, coveredDesi: 0, netQty: 0, netDesi: 0 });
              const hasStock = categoryStockMap.size > 0;
              const groupColorMap = {
                orange: { bg: 'bg-amber-50/60', border: 'border-amber-200/50', text: 'text-amber-700', label: 'text-amber-500', sub: 'text-amber-400/80' },
                blue: { bg: 'bg-sky-50/60', border: 'border-sky-200/50', text: 'text-sky-700', label: 'text-sky-500', sub: 'text-sky-400/80' },
                emerald: { bg: 'bg-teal-50/60', border: 'border-teal-200/50', text: 'text-teal-700', label: 'text-teal-500', sub: 'text-teal-400/80' },
              };
              const gc = groupColorMap[group.color as keyof typeof groupColorMap];
              const displayQty = hasStock ? groupStock.netQty : totalQty;
              const displayDesi = hasStock ? Math.round(groupStock.netDesi) : Math.round(totalDesi);
              return (
                <div key={group.key} className={`${gc.bg} ${gc.border} border rounded-xl p-4 text-center`}>
                  <p className={`text-[11px] font-medium uppercase tracking-wider mb-1.5 ${gc.label}`}>{group.label}</p>
                  <p className={`text-2xl font-bold tabular-nums ${gc.text}`}>
                    {viewMode === 'quantity' ? displayQty.toLocaleString('tr-TR') : displayDesi.toLocaleString('tr-TR')}
                  </p>
                  <p className={`text-[11px] ${gc.sub} mt-0.5`}>{hasStock ? 'net ihtiyaç' : (viewMode === 'quantity' ? 'adet' : 'desi')}</p>
                  {hasStock && (
                    <p className={`text-[10px] ${gc.sub} mt-2 pt-2 border-t ${gc.border}`}>
                      Talep {viewMode === 'quantity' ? totalQty.toLocaleString('tr-TR') : Math.round(totalDesi).toLocaleString('tr-TR')} · Depo {viewMode === 'quantity' ? groupStock.coveredQty.toLocaleString('tr-TR') : Math.round(groupStock.coveredDesi).toLocaleString('tr-TR')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Snapshot: Admin trigger + data panel */}
      {role === 'admin' && !snapshotData && (
        <button
          onClick={handleGenerateSnapshot}
          disabled={snapshotGenerating}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-50 border-2 border-dashed border-emerald-300 rounded-xl text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
        >
          <Camera className={`w-5 h-5 ${snapshotGenerating ? 'animate-pulse' : ''}`} />
          {snapshotGenerating ? 'Snapshot alınıyor...' : 'Depo Snapshot Al'}
        </button>
      )}

      {snapshotData && (
        <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden">
          <button
            onClick={() => setSnapshotOpen(!snapshotOpen)}
            className="w-full flex items-center justify-between px-4 md:px-6 py-4 bg-emerald-50 hover:bg-emerald-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Warehouse className="w-5 h-5 text-emerald-600" />
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900">Ay Kapanışı — Net Üretim İhtiyacı</p>
                <p className="text-xs text-gray-500">
                  Talep: {snapshotData.summary.totalRequested.toLocaleString()} · Stok: {snapshotData.summary.totalStock.toLocaleString()} · Net: {snapshotData.summary.totalNet.toLocaleString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {role === 'admin' && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleGenerateSnapshot(); }}
                  disabled={snapshotGenerating}
                  className="px-3 py-1 text-xs font-medium text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-lg hover:bg-emerald-200 transition-colors disabled:opacity-50"
                  title="Snapshot'ı güncelle"
                >
                  <Camera className={`w-3.5 h-3.5 ${snapshotGenerating ? 'animate-pulse' : ''}`} />
                </button>
              )}
              {snapshotOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
            </div>
          </button>
          {snapshotOpen && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">IWASKU</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Ürün</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Kategori</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Talep</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Stok</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-emerald-700 uppercase">Net İhtiyaç</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {snapshotData.snapshots.map(s => (
                    <tr key={s.iwasku} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm font-mono text-blue-600">{s.iwasku}</td>
                      <td className="px-4 py-2 text-sm text-gray-900 max-w-xs truncate">{s.productName}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{s.productCategory}</td>
                      <td className="px-4 py-2 text-sm text-right">{s.totalRequested}</td>
                      <td className="px-4 py-2 text-sm text-right text-gray-500">{s.warehouseStock}</td>
                      <td className="px-4 py-2 text-sm text-right font-bold text-emerald-700">{s.netProduction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Categories Section - Production Tracking */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Factory className="w-6 h-6 text-gray-700" />
          <h2 className="text-2xl font-semibold text-gray-900">
            Kategoriye Göre Üretim
          </h2>
        </div>
        <p className="text-gray-600 mb-6">
          Üretim ilerlemesini takip edin ve üretilen miktarları girin
        </p>

        {categories.length === 0 ? (
          <div className="bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 p-12 text-center">
            <Factory className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">Bu ay için üretim talebi bulunmuyor</p>
          </div>
        ) : (
          <div className="space-y-8">
            {PRODUCTION_GROUPS.map((group) => {
              const groupCats = categories.filter(c => getProductionGroup(c.productCategory) === group.key);
              if (groupCats.length === 0) return null;
              const GroupIcon = group.icon;
              const colorMap = {
                orange: { bg: 'bg-orange-100', hoverBg: 'group-hover:bg-orange-200', text: 'text-orange-600', border: 'hover:border-orange-500', value: 'text-orange-600' },
                blue: { bg: 'bg-blue-100', hoverBg: 'group-hover:bg-blue-200', text: 'text-blue-600', border: 'hover:border-blue-500', value: 'text-blue-600' },
                emerald: { bg: 'bg-emerald-100', hoverBg: 'group-hover:bg-emerald-200', text: 'text-emerald-600', border: 'hover:border-emerald-500', value: 'text-emerald-600' },
              };
              const colors = colorMap[group.color as keyof typeof colorMap];
              return (
                <div key={group.key}>
                  <div className="flex items-center gap-2 mb-3">
                    <GroupIcon className={`w-5 h-5 ${colors.text}`} />
                    <h3 className="text-lg font-semibold text-gray-800">{group.label}</h3>
                    <span className="text-sm text-gray-500">
                      ({groupCats.length} kategori)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groupCats.map((category) => {
                      const catStock = categoryStockMap.get(category.productCategory);
                      return (
                      <Link
                        key={category.productCategory}
                        href={`/dashboard/manufacturer/${encodeURIComponent(category.productCategory)}?month=${month}`}
                        className={`block p-6 bg-white rounded-xl border-2 border-gray-200 ${colors.border} hover:shadow-lg transition-all group`}
                      >
                        <div className="flex items-center gap-3 mb-4">
                          <div className={`p-2 ${colors.bg} rounded-lg ${colors.hoverBg} transition-colors`}>
                            <Package className={`w-6 h-6 ${colors.text}`} />
                          </div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {category.productCategory}
                          </h3>
                        </div>

                        <div className="space-y-3 mt-4 pt-4 border-t border-gray-100">
                          <div className="flex justify-between items-center">
                            <p className="text-xs text-gray-600">Ürün</p>
                            <p className="text-sm font-bold text-gray-900">{category.requestCount}</p>
                          </div>

                          {viewMode === 'desi' && category.itemsWithoutSize > 0 && (
                            <div className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded">
                              {category.itemsWithoutSize} üründe desi eksik
                            </div>
                          )}

                          <div className="flex justify-between items-center">
                            <p className="text-xs text-gray-600">Talep Edilen</p>
                            <p className={`text-sm font-bold ${colors.value}`}>
                              {viewMode === 'quantity'
                                ? `${category.totalQuantity} adet`
                                : `${Math.round(category.totalDesi)} desi`}
                            </p>
                          </div>

                          {catStock && (
                            <>
                              <div className="flex justify-between items-center">
                                <p className="text-xs text-gray-600">Depoda Bulunan</p>
                                <p className="text-sm font-bold text-emerald-600">
                                  {viewMode === 'quantity'
                                    ? `${catStock.coveredQty} adet`
                                    : `${Math.round(catStock.coveredDesi)} desi`}
                                </p>
                              </div>
                              <div className="flex justify-between items-center">
                                <p className="text-xs text-gray-600">Net İhtiyaç</p>
                                <p className={`text-sm font-bold ${catStock.netQty > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                  {viewMode === 'quantity'
                                    ? (catStock.netQty > 0 ? `${catStock.netQty} adet` : 'Yeterli')
                                    : (catStock.netDesi > 0 ? `${Math.round(catStock.netDesi)} desi` : 'Yeterli')}
                                </p>
                              </div>
                            </>
                          )}

                          <div className="flex justify-between items-center">
                            <p className="text-xs text-gray-600">Üretilen</p>
                            <p className="text-sm font-bold text-green-600">
                              {viewMode === 'quantity'
                                ? `${Math.round(category.totalProduced)} adet`
                                : `${Math.round(category.producedDesi)} desi`}
                            </p>
                          </div>

                          {(() => {
                            // Progress = üretilen / net ihtiyaç (snapshot varsa), yoksa üretilen / talep
                            const baseQty = catStock ? catStock.netQty : category.totalQuantity;
                            const baseDesi = catStock ? catStock.netDesi : category.totalDesi;
                            const pctQty = baseQty > 0 ? Math.round((category.totalProduced / baseQty) * 100) : 0;
                            const pctDesi = baseDesi > 0 ? Math.round((category.producedDesi / baseDesi) * 100) : 0;
                            const pct = viewMode === 'quantity' ? pctQty : pctDesi;
                            const barPct = Math.min(pct, 100);
                            return (
                              <div>
                                <div className="flex justify-between items-center mb-1">
                                  <p className="text-xs text-gray-600">İlerleme {catStock ? '(net)' : ''}</p>
                                  <p className="text-xs font-semibold text-gray-900">{pct}%</p>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div
                                    className="bg-gradient-to-r from-orange-500 to-green-500 h-2 rounded-full transition-all"
                                    style={{ width: `${barPct}%` }}
                                  ></div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Marketplaces Section - Request Entry */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <ShoppingCart className="w-6 h-6 text-gray-700" />
          <h2 className="text-2xl font-semibold text-gray-900">
            Pazar Yerleri
          </h2>
        </div>
        <p className="text-gray-600 mb-6">
          Her pazar yeri için yeni üretim talebi girin
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allMarketplaces.map((mp) => {
            // Find if this marketplace has requests for this month
            const summary = marketplaces.find(m => m.marketplaceId === mp.id);
            const requestCount = summary?.requestCount || 0;
            const totalQuantity = summary?.totalQuantity || 0;
            const totalDesi = summary?.totalDesi || 0;
            const displayValue = viewMode === 'quantity' ? totalQuantity : Math.round(totalDesi);

            // Get slug from code
            const slug = marketplaceSlugMap[mp.code] || mp.code.toLowerCase().replace('_', '-');

            return (
              <div key={mp.id} className="relative group">
                {role === 'admin' && (
                  <button
                    onClick={(e) => { e.preventDefault(); setEditMarketplace({ id: mp.id, name: mp.name, region: mp.region }); setShowAddMarketplaceModal(true); }}
                    className="absolute top-2 right-2 z-10 p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    title="Düzenle"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              <Link
                href={`/dashboard/marketplace/${slug}?month=${month}`}
                className="block p-6 bg-white rounded-xl border-2 border-gray-200 hover:border-purple-500 hover:shadow-lg transition-all"
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
                    <p className="text-xs text-gray-600 mb-1">Talep</p>
                    <p className={`text-xl font-bold ${requestCount > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                      {requestCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">{viewMode === 'quantity' ? 'Adet' : 'Desi'}</p>
                    <p className={`text-xl font-bold ${displayValue > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                      {displayValue}
                    </p>
                  </div>
                </div>
              </Link>
              </div>
            );
          })}

          {/* Add New Marketplace Card */}
          <button
            onClick={() => { setEditMarketplace(null); setShowAddMarketplaceModal(true); }}
            className="block p-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-300 hover:border-purple-400 hover:from-purple-50 hover:to-purple-100 transition-all group"
          >
            <div className="flex flex-col items-center justify-center h-full min-h-[140px]">
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mb-3 group-hover:bg-purple-100 transition-colors">
                <Plus className="w-6 h-6 text-gray-400 group-hover:text-purple-600 transition-colors" />
              </div>
              <h3 className="text-lg font-semibold text-gray-700 group-hover:text-purple-700 transition-colors">
                Pazar Yeri Ekle
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Özel pazar yeri oluşturun
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Add / Edit Marketplace Modal */}
      <AddMarketplaceModal
        isOpen={showAddMarketplaceModal}
        onClose={() => { setShowAddMarketplaceModal(false); setEditMarketplace(null); }}
        onSuccess={() => setRefreshMarketplaces(prev => prev + 1)}
        editData={editMarketplace}
      />
    </div>
  );
}
