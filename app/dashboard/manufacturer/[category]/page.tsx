/**
 * Manufacturer Category Page
 * View and update production for a specific category
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, Save, Calendar, Store, Download, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { formatMonthValue, parseMonthValue } from '@/lib/monthUtils';
import { createLogger } from '@/lib/logger';
import { ProductMarketplaceModal } from '@/components/modals/ProductMarketplaceModal';

const logger = createLogger('ManufacturerCategoryPage');

const STATUS_OPTIONS = [
  { value: 'REQUESTED', label: 'Talep Edildi', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  { value: 'IN_PRODUCTION', label: 'Üretimde', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  { value: 'PARTIALLY_PRODUCED', label: 'Kısmen', color: 'bg-amber-100 text-amber-700 border-amber-300' },
  { value: 'COMPLETED', label: 'Tamamlandı', color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  { value: 'CANCELLED', label: 'İptal', color: 'bg-red-100 text-red-700 border-red-300' },
] as const;

const PRIORITY_ORDER = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;

function getHighestPriority(requests: { priority: string }[]): 'HIGH' | 'MEDIUM' | 'LOW' {
  return requests.reduce((best, r) => {
    const rPri = r.priority as 'HIGH' | 'MEDIUM' | 'LOW';
    return PRIORITY_ORDER[rPri] > PRIORITY_ORDER[best] ? rPri : best;
  }, 'LOW' as 'HIGH' | 'MEDIUM' | 'LOW');
}

const PRIORITY_STYLE: Record<string, string> = {
  HIGH: 'bg-red-100 text-red-700 border-red-200',
  MEDIUM: 'bg-amber-100 text-amber-700 border-amber-200',
  LOW: 'bg-blue-100 text-blue-700 border-blue-200',
};

const PRIORITY_LABEL: Record<string, string> = {
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
};

interface Request {
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  productSize: number | null;
  marketplaceName: string;
  marketplaceColorTag?: string | null;
  quantity: number;
  producedQuantity: number | null;
  manufacturerNotes: string | null;
  status: string;
  priority: string;
  requestDate: string;
  warehouseStock: number | null;
}

interface GroupedRequest {
  iwasku: string;
  productName: string;
  productSize: number | null;
  totalQuantity: number;
  warehouseStock: number | null;
  netNeed: number;
  requestIds: string[];
  requests: Request[];
}

interface EditValues {
  [key: string]: {
    producedQuantity: number;
    manufacturerNotes: string;
    status: string;
  };
}

const statusOptions = [
  { value: 'REQUESTED', label: 'Talep Edildi' },
  { value: 'IN_PRODUCTION', label: 'Üretimde' },
  { value: 'PARTIALLY_PRODUCED', label: 'Kısmen Üretildi' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'CANCELLED', label: 'İptal Edildi' },
];

export default function ManufacturerCategoryPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const category = decodeURIComponent(params.category as string);
  const month = searchParams.get('month') || formatMonthValue(new Date());

  const [requests, setRequests] = useState<Request[]>([]);
  const [groupedRequests, setGroupedRequests] = useState<GroupedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [editValues, setEditValues] = useState<EditValues>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<GroupedRequest | null>(null);
  const [exporting, setExporting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [apiSummary, setApiSummary] = useState<Record<string, number> | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>('');
  const [availableMarketplaces, setAvailableMarketplaces] = useState<{id: string; name: string}[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const PAGE_SIZE = 30;

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const monthDate = parseMonthValue(month);
  const monthLabel = monthDate.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

  // Reset to page 1 when category, month, or filter changes
  useEffect(() => {
    setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, month, Array.from(selectedStatuses).join(), selectedMarketplace, searchQuery]);

  useEffect(() => {
    async function fetchRequests() {
      setLoading(true);
      try {
        const statusQuery = selectedStatuses.size > 0 ? `&statuses=${Array.from(selectedStatuses).join(',')}` : '';
        const mpQuery = selectedMarketplace ? `&marketplace=${selectedMarketplace}` : '';
        const searchQ = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
        const res = await fetch(`/api/manufacturer/category/${encodeURIComponent(category)}?month=${month}&page=${currentPage}&limit=${PAGE_SIZE}${statusQuery}${mpQuery}${searchQ}`);
        const data = await res.json();

        if (data.success) {
          setRequests(data.data);
          if (data.pagination) {
            setTotalPages(data.pagination.totalPages);
            setTotalItems(data.pagination.total);
          }
          if (data.availableMarketplaces) {
            setAvailableMarketplaces(data.availableMarketplaces);
          }
          if (data.summary) {
            setApiSummary(data.summary);
          }

          // Group by IWASKU
          const grouped = data.data.reduce((acc: GroupedRequest[], request: Request) => {
            const existing = acc.find(g => g.iwasku === request.iwasku);
            if (existing) {
              existing.totalQuantity += request.quantity;
              existing.requestIds.push(request.id);
              existing.requests.push(request);
              existing.netNeed = Math.max(0, existing.totalQuantity - (existing.warehouseStock ?? 0));
            } else {
              const stock = request.warehouseStock;
              acc.push({
                iwasku: request.iwasku,
                productName: request.productName,
                productSize: request.productSize,
                totalQuantity: request.quantity,
                warehouseStock: stock,
                netNeed: Math.max(0, request.quantity - (stock ?? 0)),
                requestIds: [request.id],
                requests: [request],
              });
            }
            return acc;
          }, []);

          setGroupedRequests(grouped);

          // Initialize edit values — producedQuantity is product-level (same on all requests from MonthSnapshot)
          const initialValues: EditValues = {};
          grouped.forEach((group: GroupedRequest) => {
            const totalProduced = Math.max(...group.requests.map(r => r.producedQuantity ?? 0));
            const firstRequest = group.requests[0];
            // Aggregate status: net ihtiyaç karşılandıysa COMPLETED, ürettim>0 ise PARTIALLY, else REQUESTED
            const allCompleted = group.requests.every(r => r.status === 'COMPLETED');
            const anyProgress = group.requests.some(r => r.status === 'COMPLETED' || r.status === 'PARTIALLY_PRODUCED');
            const fullyCovered = totalProduced >= group.netNeed;
            const aggStatus = (allCompleted || fullyCovered) ? 'COMPLETED' : (anyProgress || totalProduced > 0) ? 'PARTIALLY_PRODUCED' : firstRequest.status;
            initialValues[group.iwasku] = {
              producedQuantity: totalProduced,
              manufacturerNotes: firstRequest.manufacturerNotes || '',
              status: aggStatus,
            };
          });
          setEditValues(initialValues);
        }
      } catch (error) {
        logger.error('Failed to fetch requests:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchRequests();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, month, currentPage, Array.from(selectedStatuses).join(), selectedMarketplace, searchQuery]);

  const updateEditValue = (
    iwasku: string,
    field: 'producedQuantity' | 'manufacturerNotes' | 'status',
    value: string | number
  ) => {
    setEditValues((prev) => ({
      ...prev,
      [iwasku]: {
        ...prev[iwasku],
        [field]: value,
      },
    }));
  };

  const handleSave = async (iwasku: string) => {
    setSaving(iwasku);
    try {
      const group = groupedRequests.find(g => g.iwasku === iwasku);
      if (!group) return;

      const values = editValues[iwasku];
      const totalProducedQuantity = values.producedQuantity;

      // Status is computed by waterfall — no manual validation needed

      // Single PATCH: producedQuantity → MonthSnapshot.produced, waterfall handles status
      const firstRequest = group.requests[0];
      const response = await fetch(`/api/manufacturer/requests/${firstRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producedQuantity: totalProducedQuantity,
          manufacturerNotes: values.manufacturerNotes,
        }),
      });

      const allSuccess = response.ok;

      if (allSuccess) {
        // Refetch to get waterfall-updated statuses
        const refetchRes = await fetch(
          `/api/manufacturer/category/${encodeURIComponent(category)}?month=${month}&search=${iwasku}&limit=200`
        );
        const refetchData = await refetchRes.json();

        if (refetchData.success) {
          // Update local state with fresh data from server (includes waterfall changes)
          const freshRequests = refetchData.data as typeof requests;
          setRequests((prev) =>
            prev.map((r) => {
              const fresh = freshRequests.find((f: typeof r) => f.id === r.id);
              return fresh ? { ...r, ...fresh } : r;
            })
          );
        }

        const totalProduced = totalProducedQuantity;

        // Update editValues — recalculate aggregate status from refreshed requests
        const updatedGroup = groupedRequests.find(g => g.iwasku === iwasku);
        const refreshedRequests = updatedGroup?.requests ?? [];
        const allDone = refreshedRequests.every(r => r.status === 'COMPLETED');
        const anyDone = refreshedRequests.some(r => r.status === 'COMPLETED' || r.status === 'PARTIALLY_PRODUCED');
        const fullyCovered = totalProduced >= (group.netNeed ?? 0);
        const newAggStatus = (allDone || fullyCovered) ? 'COMPLETED' : (anyDone || totalProduced > 0) ? 'PARTIALLY_PRODUCED' : 'REQUESTED';

        setEditValues(prevValues => ({
          ...prevValues,
          [iwasku]: {
            ...prevValues[iwasku],
            producedQuantity: totalProduced,
            manufacturerNotes: values.manufacturerNotes,
            status: newAggStatus,
          }
        }));
      } else {
        alert('Bazı değişiklikler kaydedilemedi');
      }
    } catch (error) {
      logger.error('Save error:', error);
      alert('Değişiklikler kaydedilemedi');
    } finally {
      setSaving(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/export/category?category=${encodeURIComponent(category)}&month=${month}`);
      if (!res.ok) {
        alert('Dışa aktarılacak veri yok');
        return;
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${category.replace(/\s+/g, '-')}_${month}.xlsx`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('Export error:', error);
      alert('Dışa aktarma başarısız oldu');
    } finally {
      setExporting(false);
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
        href={`/dashboard/month/${month}`}
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {monthLabel} ayına dön
      </Link>

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Package className="w-6 h-6 md:w-8 md:h-8 text-orange-600" />
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{category}</h1>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar className="w-4 h-4" />
            <p>{monthLabel}</p>
          </div>
          <p className="text-gray-600 mt-2">
            Üretilen miktarları ve üretim notlarını girin
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || groupedRequests.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
        >
          <Download className={`w-4 h-4 ${exporting ? 'animate-bounce' : ''}`} />
          {exporting ? 'İndiriliyor...' : 'Excel İndir'}
        </button>
      </div>

      {/* Search + Filters */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="IWASKU veya ürün adı ile ara..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent placeholder:text-slate-400"
        />
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Status filter */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 mr-1">Durum:</span>
          {STATUS_OPTIONS.map((opt) => {
            const isActive = selectedStatuses.has(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() => {
                  setSelectedStatuses(prev => {
                    const next = new Set(prev);
                    if (next.has(opt.value)) next.delete(opt.value);
                    else next.add(opt.value);
                    return next;
                  });
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  isActive
                    ? opt.color
                    : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
          {selectedStatuses.size > 0 && (
            <button
              onClick={() => setSelectedStatuses(new Set())}
              className="px-2 py-1 text-xs text-slate-400 hover:text-slate-600"
            >
              Temizle
            </button>
          )}
        </div>
        {/* Marketplace filter */}
        {availableMarketplaces.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500 mr-1">Pazar Yeri:</span>
            <button
              onClick={() => setSelectedMarketplace('')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                !selectedMarketplace
                  ? 'bg-purple-100 text-purple-700 border-purple-300'
                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
              }`}
            >
              Tümü
            </button>
            {availableMarketplaces.map((mp) => (
              <button
                key={mp.id}
                onClick={() => setSelectedMarketplace(selectedMarketplace === mp.id ? '' : mp.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  selectedMarketplace === mp.id
                    ? 'bg-purple-100 text-purple-700 border-purple-300'
                    : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                }`}
              >
                {mp.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Summary Card — API'dan gelen tüm kategori toplamı */}
      {apiSummary && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
            <div>
              <p className="text-xs text-gray-500">Talep</p>
              <p className="text-lg font-bold text-gray-900">{apiSummary.talep.toLocaleString('tr-TR')}</p>
              <p className="text-[10px] text-gray-400">{apiSummary.talepDesi.toLocaleString('tr-TR')} desi</p>
            </div>
            <div>
              <p className="text-xs text-emerald-600">Stok</p>
              <p className="text-lg font-bold text-emerald-700">{apiSummary.stok.toLocaleString('tr-TR')}</p>
              <p className="text-[10px] text-emerald-400">{apiSummary.stokDesi.toLocaleString('tr-TR')} desi</p>
            </div>
            <div>
              <p className="text-xs text-blue-600">Net Ihtiyac</p>
              <p className="text-lg font-bold text-blue-700">{apiSummary.netIhtiyac.toLocaleString('tr-TR')}</p>
              <p className="text-[10px] text-blue-400">{apiSummary.netDesi.toLocaleString('tr-TR')} desi</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Uretilen</p>
              <p className="text-lg font-bold text-gray-900">{apiSummary.uretilen.toLocaleString('tr-TR')}</p>
              <p className="text-[10px] text-gray-400">{apiSummary.uretilenDesi.toLocaleString('tr-TR')} desi</p>
            </div>
            <div>
              <p className="text-xs text-red-500">Kalan</p>
              <p className={`text-lg font-bold ${apiSummary.kalan === 0 ? 'text-green-600' : 'text-red-600'}`}>{apiSummary.kalan.toLocaleString('tr-TR')}</p>
              <p className={`text-[10px] ${apiSummary.kalan === 0 ? 'text-green-400' : 'text-red-400'}`}>{apiSummary.kalanDesi.toLocaleString('tr-TR')} desi</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Ilerleme</p>
              <p className={`text-lg font-bold ${apiSummary.pct >= 100 ? 'text-green-600' : 'text-gray-900'}`}>{apiSummary.pct}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Requests Table */}
      {groupedRequests.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Package className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600">{monthLabel} ayında bu kategori için üretim talebi bulunmuyor</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    IWASKU
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Ürün Adı
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Talep
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-emerald-700 uppercase tracking-wider">
                    Stok
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-blue-700 uppercase tracking-wider">
                    Net İhtiyaç
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Üretilen
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-red-600 uppercase tracking-wider">
                    Kalan
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Durum
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Notlar
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    İşlem
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {groupedRequests.map((group) => {
                  const totalProducedQty = group.requests.reduce((s, r) => Math.max(s, r.producedQuantity ?? 0), 0);
                  const available = (group.warehouseStock ?? 0) + totalProducedQty;
                  const isFulfilled = available >= group.totalQuantity;
                  return (
                  <tr key={group.iwasku} className={isFulfilled ? 'bg-green-50/60 hover:bg-green-100/60' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {(() => {
                        const uniqueMarketplaceCount = new Set(group.requests.map(r => r.marketplaceName)).size;
                        const highestPriority = getHighestPriority(group.requests);
                        return (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-mono text-gray-900">
                              {group.iwasku}
                            </span>
                            {uniqueMarketplaceCount > 1 ? (
                              <button
                                onClick={() => setSelectedProduct(group)}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 transition-colors"
                                title="Pazar yeri dağılımını gör"
                              >
                                <Store className="w-3 h-3" />
                                {uniqueMarketplaceCount}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">{group.requests[0].marketplaceName}</span>
                            )}
                            <span className={`text-xs px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[highestPriority]}`}>
                              {PRIORITY_LABEL[highestPriority]}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-900">
                        {group.productName}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm font-semibold text-gray-900">
                        {group.totalQuantity}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm text-emerald-700">
                        {group.warehouseStock !== null ? group.warehouseStock : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-sm font-semibold ${group.netNeed > 0 ? 'text-blue-700' : 'text-green-600'}`}>
                        {group.warehouseStock !== null ? (group.netNeed > 0 ? group.netNeed : '✓ Yeterli') : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <input
                        type="text"
                        defaultValue={editValues[group.iwasku]?.producedQuantity || 0}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const current = editValues[group.iwasku]?.producedQuantity || 0;
                          let newVal: number;
                          if (raw.startsWith('+')) {
                            newVal = current + (parseInt(raw.slice(1)) || 0);
                          } else {
                            newVal = parseInt(raw) || 0;
                          }
                          e.target.value = String(newVal);
                          updateEditValue(group.iwasku, 'producedQuantity', newVal);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-20 px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {(() => {
                        const produced = editValues[group.iwasku]?.producedQuantity || 0;
                        const remaining = Math.max(0, group.netNeed - produced);
                        return (
                          <span className={`text-sm font-semibold ${remaining === 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {group.warehouseStock !== null ? (remaining === 0 ? '✓' : remaining) : '-'}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {(() => {
                        const s = editValues[group.iwasku]?.status || group.requests[0].status;
                        const label = s === 'COMPLETED' ? 'Tamamlandı' : s === 'PARTIALLY_PRODUCED' ? 'Kısmen' : s === 'REQUESTED' ? 'Talep Edildi' : s;
                        const color = s === 'COMPLETED' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : s === 'PARTIALLY_PRODUCED' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-slate-600 bg-slate-50 border-slate-200';
                        return <span className={`text-xs font-medium px-2 py-1 rounded border ${color}`}>{label}</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <textarea
                        value={editValues[group.iwasku]?.manufacturerNotes || ''}
                        onChange={(e) =>
                          updateEditValue(group.iwasku, 'manufacturerNotes', e.target.value)
                        }
                        placeholder="Üretim notları..."
                        rows={1}
                        className="w-full px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleSave(group.iwasku)}
                        disabled={saving === group.iwasku}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {saving === group.iwasku ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Kaydediliyor...
                          </>
                        ) : (
                          <>
                            <Save className="w-3.5 h-3.5" />
                            Kaydet
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-sm text-gray-600">
            Toplam <span className="font-medium">{totalItems}</span> talep
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Önceki
            </button>
            <span className="text-sm text-gray-700">
              <span className="font-medium">{currentPage}</span> / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Sonraki
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Marketplace Breakdown Modal */}
      <ProductMarketplaceModal
        isOpen={selectedProduct !== null}
        onClose={() => setSelectedProduct(null)}
        iwasku={selectedProduct?.iwasku || ''}
        productName={selectedProduct?.productName || ''}
        requests={selectedProduct?.requests.reduce((acc, r) => {
          const pri = r.priority as 'HIGH' | 'MEDIUM' | 'LOW';
          const existing = acc.find(x => x.marketplaceName === r.marketplaceName);
          if (existing) {
            existing.quantity += r.quantity;
            if (PRIORITY_ORDER[pri] > PRIORITY_ORDER[existing.priority as 'HIGH' | 'MEDIUM' | 'LOW']) {
              existing.priority = pri;
            }
            // If any request for this marketplace is not COMPLETED, overall is not completed
            if (r.status !== 'COMPLETED') existing.status = r.status;
          } else {
            acc.push({ marketplaceName: r.marketplaceName, quantity: r.quantity, colorTag: r.marketplaceColorTag, priority: pri, status: r.status, manufacturerNotes: r.manufacturerNotes });
          }
          return acc;
        }, [] as Array<{ marketplaceName: string; quantity: number; colorTag?: string | null; priority: string; status?: string; manufacturerNotes?: string | null }>) || []}
      />
    </div>
  );
}
