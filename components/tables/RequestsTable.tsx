/**
 * Requests Table Component
 * Displays production requests for a marketplace with status filtering,
 * shipment routing (button-per-method), and bulk operations.
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calendar, Package, Trash2, CheckSquare, Square, Check, Loader2,
  Anchor, Truck, Plane, Filter,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RequestsTable');
const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL || 'https://apps.iwa.web.tr';

export interface RequestSummary {
  total: number;
  totalQty: number;
  totalDesi: number;
  completed: number;
  completedQty: number;
  completedDesi: number;
  partial: number;
  requested: number;
}

interface RequestsTableProps {
  marketplaceId: string;
  month?: string;
  refreshTrigger?: number;
  onDelete?: () => void;
  archiveMode?: boolean;
  onSummary?: (summary: RequestSummary) => void;
}

interface RoutedShipment { id: string; name: string; }

interface Request {
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  productSize: number | null;
  quantity: number;
  status: string;
  priority: string;
  requestDate: string;
  productionMonth: string;
  createdAt: string;
  notes: string | null;
  routedShipment: RoutedShipment | null;
  enteredBy: { name: string };
}

interface AvailableShipment {
  id: string;
  name: string;
  status: string;
  plannedDate: string;
  shippingMethod: string;
}

const PRIORITY_STYLE: Record<string, string> = {
  HIGH: 'bg-red-100 text-red-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-blue-100 text-blue-700',
};
const PRIORITY_LABEL: Record<string, string> = { HIGH: 'Yuksek', MEDIUM: 'Orta', LOW: 'Dusuk' };

const STATUS_COLORS: Record<string, string> = {
  REQUESTED: 'bg-blue-100 text-blue-700',
  IN_PRODUCTION: 'bg-orange-100 text-orange-700',
  PARTIALLY_PRODUCED: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-700',
};
const STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Talep Edildi',
  IN_PRODUCTION: 'Uretimde',
  PARTIALLY_PRODUCED: 'Kismen Uretildi',
  COMPLETED: 'Tamamlandi',
  CANCELLED: 'Iptal Edildi',
};

const METHOD_ICON: Record<string, typeof Anchor> = { sea: Anchor, road: Truck, air: Plane };
const METHOD_LABEL: Record<string, string> = { sea: 'Deniz', road: 'Kara', air: 'Hava' };

const PAGE_SIZE = 30;

export function RequestsTable({ marketplaceId, month, refreshTrigger, onDelete, archiveMode = false, onSummary }: RequestsTableProps) {
  const { hasRole } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Shipment routing state
  const [availableShipments, setAvailableShipments] = useState<AvailableShipment[]>([]);
  const [shipmentsLoaded, setShipmentsLoaded] = useState(false);
  const [routingId, setRoutingId] = useState<string | null>(null);
  const [bulkRouting, setBulkRouting] = useState(false);

  const isAdmin = hasRole(['admin']);
  const isEditor = hasRole(['admin', 'editor']);

  // Fetch requests
  useEffect(() => {
    async function fetchRequests() {
      setLoading(true);
      try {
        const archiveParam = archiveMode ? '&archiveMode=true' : '';
        const monthParam = month && !archiveMode ? `&month=${month}` : '';
        const res = await fetch(`/api/requests?marketplaceId=${marketplaceId}&limit=5000${archiveParam}${monthParam}`);
        const data = await res.json();
        if (data.success) {
          const sorted = [...data.data].sort((a: Request, b: Request) => a.iwasku.localeCompare(b.iwasku));
          setRequests(sorted);
          if (onSummary) {
            const desiCalc = (arr: Request[]) => arr.reduce((s, r) => s + r.quantity * (r.productSize ?? 0), 0);
            const completedArr = sorted.filter((r: Request) => r.status === 'COMPLETED');
            onSummary({
              total: sorted.length,
              totalQty: sorted.reduce((s: number, r: Request) => s + r.quantity, 0),
              totalDesi: desiCalc(sorted),
              completed: completedArr.length,
              completedQty: completedArr.reduce((s: number, r: Request) => s + r.quantity, 0),
              completedDesi: desiCalc(completedArr),
              partial: sorted.filter((r: Request) => r.status === 'PARTIALLY_PRODUCED').length,
              requested: sorted.filter((r: Request) => r.status === 'REQUESTED').length,
            });
          }
        }
      } catch (error) {
        logger.error('Failed to fetch requests:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchRequests();
    setSelectedIds(new Set());
    setPage(1);
    setShipmentsLoaded(false);
  }, [marketplaceId, month, refreshTrigger, archiveMode]);

  // Fetch available shipments
  useEffect(() => {
    if (shipmentsLoaded || !isAdmin) return;
    if (!requests.some(r => r.status === 'COMPLETED')) return;

    (async () => {
      try {
        const res = await fetch(`/api/requests/routable-shipments?marketplaceId=${marketplaceId}`);
        const data = await res.json();
        if (data.success) setAvailableShipments(data.data.shipments);
      } catch (error) {
        logger.error('Failed to fetch routable shipments:', error);
      } finally {
        setShipmentsLoaded(true);
      }
    })();
  }, [requests, marketplaceId, shipmentsLoaded, isAdmin]);

  // Status counts for filter pills
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of requests) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return counts;
  }, [requests]);

  // Filtered + paginated
  const filteredRequests = useMemo(
    () => statusFilter ? requests.filter(r => r.status === statusFilter) : requests,
    [requests, statusFilter]
  );
  const totalPages = Math.ceil(filteredRequests.length / PAGE_SIZE);
  const paginatedRequests = filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Selected completed unrouted for bulk routing
  const selectedCompletedIds = useMemo(
    () => [...selectedIds].filter(id => {
      const req = requests.find(r => r.id === id);
      return req && req.status === 'COMPLETED' && !req.routedShipment;
    }),
    [selectedIds, requests]
  );

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredRequests.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRequests.map(r => r.id)));
    }
  };

  const handleStatusFilter = (status: string | null) => {
    setStatusFilter(status);
    setPage(1);
    setSelectedIds(new Set());
  };

  // Route single request
  const handleRouteToShipment = useCallback(async (requestId: string, shipmentId: string) => {
    setRoutingId(requestId);
    try {
      const res = await fetch('/api/requests/route-to-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestIds: [requestId], shipmentId }),
      });
      const data = await res.json();
      if (data.success) {
        const shipment = availableShipments.find(s => s.id === shipmentId);
        setRequests(prev => prev.map(r =>
          r.id === requestId
            ? { ...r, routedShipment: { id: shipmentId, name: shipment?.name ?? data.data.shipmentName } }
            : r
        ));
      } else {
        alert(data.error || 'Yonlendirme basarisiz');
      }
    } catch (error) {
      logger.error('Route to shipment error:', error);
      alert('Sevkiyata yonlendirme basarisiz');
    } finally {
      setRoutingId(null);
    }
  }, [availableShipments]);

  // Bulk route
  const handleBulkRoute = useCallback(async (shipmentId: string) => {
    if (selectedCompletedIds.length === 0) return;
    setBulkRouting(true);
    try {
      const res = await fetch('/api/requests/route-to-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestIds: selectedCompletedIds, shipmentId }),
      });
      const data = await res.json();
      if (data.success) {
        const shipment = availableShipments.find(s => s.id === shipmentId);
        const routedSet = new Set(selectedCompletedIds);
        setRequests(prev => prev.map(r =>
          routedSet.has(r.id)
            ? { ...r, routedShipment: { id: shipmentId, name: shipment?.name ?? data.data.shipmentName } }
            : r
        ));
        setSelectedIds(new Set());
      } else {
        alert(data.error || 'Toplu yonlendirme basarisiz');
      }
    } catch (error) {
      logger.error('Bulk route error:', error);
      alert('Toplu yonlendirme basarisiz');
    } finally {
      setBulkRouting(false);
    }
  }, [selectedCompletedIds, availableShipments]);

  // Delete handlers
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size} talebi silmek istediginize emin misiniz?`)) return;
    setBulkDeleting(true);
    try {
      const failedIds: string[] = [];
      for (const id of Array.from(selectedIds)) {
        try {
          const res = await fetch(`/api/requests/${id}`, { method: 'DELETE' });
          if (res.status === 429) { alert('Rate limit asildi.'); break; }
          if (res.status === 401) { window.location.href = SSO_URL; return; }
          if (res.status === 403) { alert('Yetkiniz yok.'); return; }
          const data = await res.json();
          if (!data.success) failedIds.push(id);
        } catch { failedIds.push(id); }
      }
      const deletedIds = Array.from(selectedIds).filter(id => !failedIds.includes(id));
      setRequests(prev => prev.filter(r => !deletedIds.includes(r.id)));
      setSelectedIds(new Set(failedIds));
      if (deletedIds.length > 0 && onDelete) onDelete();
    } finally { setBulkDeleting(false); }
  };

  const handleDelete = async (requestId: string) => {
    if (!confirm('Bu talebi silmek istediginize emin misiniz?')) return;
    setDeleting(requestId);
    try {
      const res = await fetch(`/api/requests/${requestId}`, { method: 'DELETE' });
      if (res.status === 429 || res.status === 401 || res.status === 403) return;
      const data = await res.json();
      if (data.success) {
        setRequests(prev => prev.filter(r => r.id !== requestId));
        if (onDelete) onDelete();
      } else { alert(data.error || 'Talep silinemedi'); }
    } finally { setDeleting(null); }
  };

  // Render shipment cell — 2 buttons stacked or routed badge
  const renderShipmentCell = (request: Request) => {
    if (request.status !== 'COMPLETED') return <span className="text-gray-300">—</span>;

    if (request.routedShipment) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded">
          <Check className="w-3 h-3" />
          {request.routedShipment.name}
        </span>
      );
    }

    if (!isAdmin) return <span className="text-xs text-gray-400">Bekliyor</span>;
    if (!shipmentsLoaded) return <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />;
    if (availableShipments.length === 0) return <span className="text-xs text-gray-400">Rota yok</span>;
    if (routingId === request.id) return <Loader2 className="w-3.5 h-3.5 text-purple-600 animate-spin" />;

    return (
      <div className="flex flex-col gap-1">
        {availableShipments.map(s => {
          const Icon = METHOD_ICON[s.shippingMethod] ?? Anchor;
          const label = METHOD_LABEL[s.shippingMethod] ?? s.shippingMethod;
          return (
            <button
              key={s.id}
              onClick={() => handleRouteToShipment(request.id, s.id)}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 transition-colors"
              title={s.name}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12">
        <div className="flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Package className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Henuz talep yok</h3>
          <p className="text-sm text-gray-600">Yukaridan ilk uretim talebinizi ekleyerek baslayin</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Filter Pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-gray-400" />
        <button
          onClick={() => handleStatusFilter(null)}
          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
            !statusFilter ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Tumu ({requests.length})
        </button>
        {Object.entries(statusCounts).map(([status, count]) => (
          <button
            key={status}
            onClick={() => handleStatusFilter(status)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              statusFilter === status
                ? STATUS_COLORS[status]?.replace('bg-', 'bg-').replace('100', '200') || 'bg-gray-200 text-gray-800'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {STATUS_LABELS[status] || status} ({count})
          </button>
        ))}
      </div>

      {/* Bulk Actions Bar */}
      {isEditor && selectedIds.size > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-sm font-medium text-purple-900">
            {selectedIds.size} oge secildi
            {selectedCompletedIds.length > 0 && selectedCompletedIds.length < selectedIds.size && (
              <span className="text-purple-600"> ({selectedCompletedIds.length} tamamlanmis)</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {/* Bulk Route buttons — one per available shipment */}
            {isAdmin && selectedCompletedIds.length > 0 && availableShipments.map(s => {
              const Icon = METHOD_ICON[s.shippingMethod] ?? Anchor;
              const label = METHOD_LABEL[s.shippingMethod] ?? s.shippingMethod;
              return (
                <button
                  key={s.id}
                  onClick={() => handleBulkRoute(s.id)}
                  disabled={bulkRouting}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={s.name}
                >
                  {bulkRouting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                  {selectedCompletedIds.length} {label}
                </button>
              );
            })}
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {bulkDeleting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Sil
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <colgroup>
              {isEditor && <col className="w-12" />}
              <col className="w-28" />
              <col className="w-32" />
              <col className="w-36" />
              <col className="w-auto" />
              <col className="w-44" />
              <col className="w-20" />
              <col className="w-20" />
              <col className="w-28" />
              {isAdmin && <col className="w-28" />}
              {isEditor && <col className="w-16" />}
            </colgroup>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {isEditor && (
                  <th className="px-4 py-3 text-center">
                    <button onClick={handleSelectAll} className="text-gray-600 hover:text-purple-600 transition-colors">
                      {selectedIds.size === filteredRequests.length && filteredRequests.length > 0
                        ? <CheckSquare className="w-5 h-5" />
                        : <Square className="w-5 h-5" />}
                    </button>
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Uretim Ayi</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Tarih</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">IWASKU</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Urun Adi</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Kategori</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Miktar</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Oncelik</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Durum</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Sevkiyat</th>
                {isEditor && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Sil</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {paginatedRequests.map((request) => (
                <tr key={request.id} className={`transition-colors ${selectedIds.has(request.id) ? 'bg-purple-50' : 'hover:bg-gray-50'}`}>
                  {isEditor && (
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleToggleSelect(request.id)} className="text-gray-600 hover:text-purple-600 transition-colors">
                        {selectedIds.has(request.id) ? <CheckSquare className="w-5 h-5 text-purple-600" /> : <Square className="w-5 h-5" />}
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {(() => {
                      const [year, m] = request.productionMonth.split('-');
                      return new Date(parseInt(year), parseInt(m) - 1, 1).toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' });
                    })()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-sm text-gray-900">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      {new Date(request.createdAt).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-900">{request.iwasku}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-900 leading-tight line-clamp-2 whitespace-normal" title={request.productName}>
                      {request.productName}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-600 truncate" title={request.productCategory}>{request.productCategory}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">{request.quantity}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_STYLE[request.priority] ?? PRIORITY_STYLE.MEDIUM}`}>
                      {PRIORITY_LABEL[request.priority] ?? 'Orta'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[request.status]}`}>
                      {STATUS_LABELS[request.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">{renderShipmentCell(request)}</td>
                  {isEditor && (
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleDelete(request.id)}
                        disabled={deleting === request.id}
                        className="inline-flex items-center p-1.5 text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                      >
                        {deleting === request.id
                          ? <div className="w-3.5 h-3.5 border-2 border-red-700 border-t-transparent rounded-full animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500">
              {filteredRequests.length} talepten {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredRequests.length)} gosteriliyor
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-100">‹ Onceki</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .map((p, idx, arr) => (
                  <span key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-gray-400">…</span>}
                    <button onClick={() => setPage(p)}
                      className={`px-3 py-1 text-sm rounded-lg ${page === p ? 'bg-purple-600 text-white' : 'border hover:bg-gray-100'}`}>{p}</button>
                  </span>
                ))}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-100">Sonraki ›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
