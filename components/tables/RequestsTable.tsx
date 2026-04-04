/**
 * Requests Table Component
 * Displays recent production requests for a marketplace
 * With bulk delete, shipment routing functionality and production month display
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Calendar, Package, Trash2, CheckSquare, Square, Ship, Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RequestsTable');
const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL || 'https://apps.iwa.web.tr';

interface RequestsTableProps {
  marketplaceId: string;
  month?: string;
  refreshTrigger?: number;
  onDelete?: () => void;
  archiveMode?: boolean;
}

interface RoutedShipment {
  id: string;
  name: string;
}

interface Request {
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  quantity: number;
  status: string;
  priority: string;
  requestDate: string;
  productionMonth: string;
  createdAt: string;
  notes: string | null;
  routedShipment: RoutedShipment | null;
  enteredBy: {
    name: string;
  };
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

const PRIORITY_LABEL: Record<string, string> = {
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
};

const statusColors = {
  REQUESTED: 'bg-blue-100 text-blue-700',
  IN_PRODUCTION: 'bg-orange-100 text-orange-700',
  PARTIALLY_PRODUCED: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-700',
};

const statusLabels = {
  REQUESTED: 'Talep Edildi',
  IN_PRODUCTION: 'Üretimde',
  PARTIALLY_PRODUCED: 'Kısmen Üretildi',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal Edildi',
};

const PAGE_SIZE = 30;

export function RequestsTable({ marketplaceId, month, refreshTrigger, onDelete, archiveMode = false }: RequestsTableProps) {
  const { role, hasRole } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [page, setPage] = useState(1);

  // Shipment routing state
  const [availableShipments, setAvailableShipments] = useState<AvailableShipment[]>([]);
  const [shipmentsLoaded, setShipmentsLoaded] = useState(false);
  const [routingId, setRoutingId] = useState<string | null>(null); // ID of request currently being routed
  const [bulkRouting, setBulkRouting] = useState(false);
  const [bulkShipmentId, setBulkShipmentId] = useState<string>('');

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

  // Fetch available shipments for this marketplace (once, when there are COMPLETED requests)
  useEffect(() => {
    if (shipmentsLoaded || !isAdmin) return;
    const hasCompleted = requests.some(r => r.status === 'COMPLETED');
    if (!hasCompleted) return;

    async function fetchShipments() {
      try {
        const res = await fetch(`/api/requests/routable-shipments?marketplaceId=${marketplaceId}`);
        const data = await res.json();
        if (data.success) {
          setAvailableShipments(data.data.shipments);
        }
      } catch (error) {
        logger.error('Failed to fetch routable shipments:', error);
      } finally {
        setShipmentsLoaded(true);
      }
    }

    fetchShipments();
  }, [requests, marketplaceId, shipmentsLoaded, isAdmin]);

  // Pagination
  const totalPages = Math.ceil(requests.length / PAGE_SIZE);
  const paginatedRequests = requests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Selected completed (unrouted) requests for bulk routing
  const selectedCompletedIds = [...selectedIds].filter(id => {
    const req = requests.find(r => r.id === id);
    return req && req.status === 'COMPLETED' && !req.routedShipment;
  });

  const handleToggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === requests.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(requests.map(r => r.id)));
    }
  };

  // Route single request to shipment
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
        // Update local state with routed shipment info
        const shipment = availableShipments.find(s => s.id === shipmentId);
        setRequests(prev => prev.map(r =>
          r.id === requestId
            ? { ...r, routedShipment: { id: shipmentId, name: shipment?.name ?? data.data.shipmentName } }
            : r
        ));
      } else {
        alert(data.error || 'Yönlendirme başarısız');
      }
    } catch (error) {
      logger.error('Route to shipment error:', error);
      alert('Sevkiyata yönlendirme başarısız');
    } finally {
      setRoutingId(null);
    }
  }, [availableShipments]);

  // Bulk route selected completed requests
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
        setBulkShipmentId('');
      } else {
        alert(data.error || 'Toplu yönlendirme başarısız');
      }
    } catch (error) {
      logger.error('Bulk route error:', error);
      alert('Toplu yönlendirme başarısız');
    } finally {
      setBulkRouting(false);
    }
  }, [selectedCompletedIds, availableShipments]);

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    if (!confirm(`${selectedIds.size} talebi silmek istediğinize emin misiniz?`)) {
      return;
    }

    setBulkDeleting(true);
    try {
      const failedIds: string[] = [];
      let rateLimited = false;

      for (const id of Array.from(selectedIds)) {
        try {
          const res = await fetch(`/api/requests/${id}`, { method: 'DELETE' });

          if (res.status === 429) {
            rateLimited = true;
            alert('Rate limit asildi. Lutfen birkac saniye bekleyip tekrar deneyin.');
            break;
          }
          if (res.status === 401) {
            window.location.href = SSO_URL;
            return;
          }
          if (res.status === 403) {
            alert('Bu islem icin yetkiniz yok.');
            return;
          }

          const data = await res.json();
          if (!data.success) failedIds.push(id);
        } catch (error) {
          logger.error(`Failed to delete ${id}:`, error);
          failedIds.push(id);
        }
      }

      const deletedIds = Array.from(selectedIds).filter(id => !failedIds.includes(id));
      setRequests(requests.filter(r => !deletedIds.includes(r.id)));
      setSelectedIds(new Set(failedIds));

      if (failedIds.length > 0 && !rateLimited) {
        alert(`${deletedIds.length} talep silindi, ${failedIds.length} talep silinemedi.`);
      } else if (!rateLimited && deletedIds.length > 0) {
        alert(`${deletedIds.length} talep basariyla silindi.`);
      }

      if (deletedIds.length > 0 && onDelete) onDelete();
    } catch (error) {
      logger.error('Bulk delete error:', error);
      alert('Toplu silme islemi basarisiz oldu.');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDelete = async (requestId: string) => {
    if (!confirm('Bu talebi silmek istediginize emin misiniz?')) return;

    setDeleting(requestId);
    try {
      const res = await fetch(`/api/requests/${requestId}`, { method: 'DELETE' });

      if (res.status === 429) {
        alert('Cok fazla istek yaptiniz. Lutfen birkac saniye bekleyip tekrar deneyin.');
        return;
      }
      if (res.status === 401) {
        window.location.href = SSO_URL;
        return;
      }
      if (res.status === 403) {
        alert('Bu islem icin yetkiniz yok.');
        return;
      }

      const data = await res.json();
      if (data.success) {
        setRequests(requests.filter(r => r.id !== requestId));
        if (onDelete) onDelete();
      } else {
        alert(data.error || 'Talep silinemedi');
      }
    } catch (error) {
      logger.error('Delete error:', error);
      alert('Talep silinemedi');
    } finally {
      setDeleting(null);
    }
  };

  // Render shipment cell for a request
  const renderShipmentCell = (request: Request) => {
    if (request.status !== 'COMPLETED') {
      return <span className="text-gray-300">—</span>;
    }

    // Already routed
    if (request.routedShipment) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-700">
          <Check className="w-3.5 h-3.5" />
          {request.routedShipment.name}
        </span>
      );
    }

    // Loading shipments
    if (!shipmentsLoaded) {
      return <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />;
    }

    // No route configured
    if (availableShipments.length === 0) {
      return <span className="text-xs text-gray-400">Rota yok</span>;
    }

    // Currently routing this request
    if (routingId === request.id) {
      return <Loader2 className="w-3.5 h-3.5 text-purple-600 animate-spin" />;
    }

    // Single shipment: one-click button
    if (availableShipments.length === 1) {
      const shipment = availableShipments[0];
      return (
        <button
          onClick={() => handleRouteToShipment(request.id, shipment.id)}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 transition-colors"
          title={`${shipment.name} sevkiyatina ekle`}
        >
          <Ship className="w-3 h-3" />
          {shipment.name}
        </button>
      );
    }

    // Multiple shipments: dropdown
    return (
      <ShipmentDropdown
        shipments={availableShipments}
        onSelect={(shipmentId) => handleRouteToShipment(request.id, shipmentId)}
      />
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12">
        <div className="flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
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
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Henuz talep yok
          </h3>
          <p className="text-sm text-gray-600">
            Yukaridan ilk uretim talebinizi ekleyerek baslayin
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk Actions Bar */}
      {isEditor && selectedIds.size > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-sm font-medium text-purple-900">
            {selectedIds.size} oge secildi
          </p>
          <div className="flex items-center gap-3">
            {/* Bulk Route — only for admin, when completed unrouted items selected */}
            {isAdmin && selectedCompletedIds.length > 0 && availableShipments.length > 0 && (
              <div className="flex items-center gap-2">
                {availableShipments.length === 1 ? (
                  <button
                    onClick={() => handleBulkRoute(availableShipments[0].id)}
                    disabled={bulkRouting}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {bulkRouting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Ship className="w-4 h-4" />
                    )}
                    {selectedCompletedIds.length} talebi {availableShipments[0].name} sevkiyatina yonlendir
                  </button>
                ) : (
                  <>
                    <select
                      value={bulkShipmentId}
                      onChange={e => setBulkShipmentId(e.target.value)}
                      className="px-3 py-2 text-sm border border-purple-200 rounded-lg bg-white"
                    >
                      <option value="">Sevkiyat sec...</option>
                      {availableShipments.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => bulkShipmentId && handleBulkRoute(bulkShipmentId)}
                      disabled={!bulkShipmentId || bulkRouting}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {bulkRouting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Ship className="w-4 h-4" />
                      )}
                      {selectedCompletedIds.length} talebi yonlendir
                    </button>
                  </>
                )}
              </div>
            )}
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {bulkDeleting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Siliniyor...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Secilenleri Sil
                </>
              )}
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
              {isAdmin && <col className="w-36" />}
              {isEditor && <col className="w-16" />}
            </colgroup>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {isEditor && (
                  <th className="px-4 py-3 text-center">
                    <button
                      onClick={handleSelectAll}
                      className="text-gray-600 hover:text-purple-600 transition-colors"
                      title={selectedIds.size === requests.length ? 'Tumunu kaldir' : 'Tumunu sec'}
                    >
                      {selectedIds.size === requests.length ? (
                        <CheckSquare className="w-5 h-5" />
                      ) : (
                        <Square className="w-5 h-5" />
                      )}
                    </button>
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Uretim Ayi
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Tarih
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  IWASKU
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Urun Adi
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Kategori
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Miktar
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Oncelik
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Durum
                </th>
                {isAdmin && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Sevkiyat
                  </th>
                )}
                {isEditor && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Sil
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {paginatedRequests.map((request) => (
                <tr key={request.id} className={`transition-colors ${selectedIds.has(request.id) ? 'bg-purple-50' : 'hover:bg-gray-50'}`}>
                  {isEditor && (
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggleSelect(request.id)}
                        className="text-gray-600 hover:text-purple-600 transition-colors"
                      >
                        {selectedIds.has(request.id) ? (
                          <CheckSquare className="w-5 h-5 text-purple-600" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-900">
                      {(() => {
                        const [year, m] = request.productionMonth.split('-');
                        return new Date(parseInt(year), parseInt(m) - 1, 1).toLocaleDateString('tr-TR', {
                          month: 'short',
                          year: 'numeric',
                        });
                      })()}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-sm text-gray-900">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      {new Date(request.createdAt).toLocaleDateString('tr-TR', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm font-mono text-gray-900">
                      {request.iwasku}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-900 leading-tight line-clamp-2 whitespace-normal" title={request.productName}>
                      {request.productName}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-600 truncate" title={request.productCategory}>
                      {request.productCategory}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm font-semibold text-gray-900">
                      {request.quantity}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_STYLE[request.priority] ?? PRIORITY_STYLE['MEDIUM']}`}>
                      {PRIORITY_LABEL[request.priority] ?? 'Orta'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        statusColors[request.status as keyof typeof statusColors]
                      }`}
                    >
                      {statusLabels[request.status as keyof typeof statusLabels]}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 whitespace-nowrap">
                      {renderShipmentCell(request)}
                    </td>
                  )}
                  {isEditor && (
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleDelete(request.id)}
                        disabled={deleting === request.id}
                        className="inline-flex items-center p-1.5 text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Talebi sil"
                      >
                        {deleting === request.id ? (
                          <div className="w-3.5 h-3.5 border-2 border-red-700 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
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
              {requests.length} talepten {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, requests.length)} gosteriliyor
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-100"
              >
                ‹ Onceki
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .map((p, idx, arr) => (
                  <span key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-gray-400">…</span>}
                    <button
                      onClick={() => setPage(p)}
                      className={`px-3 py-1 text-sm rounded-lg ${page === p ? 'bg-purple-600 text-white' : 'border hover:bg-gray-100'}`}
                    >
                      {p}
                    </button>
                  </span>
                ))
              }
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-100"
              >
                Sonraki ›
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline dropdown for selecting from multiple shipments
function ShipmentDropdown({ shipments, onSelect }: { shipments: AvailableShipment[]; onSelect: (id: string) => void }) {
  const [selected, setSelected] = useState('');

  return (
    <div className="flex items-center gap-1">
      <select
        value={selected}
        onChange={e => setSelected(e.target.value)}
        className="w-24 px-1.5 py-1 text-xs border border-gray-200 rounded bg-white"
      >
        <option value="">Sec...</option>
        {shipments.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {selected && (
        <button
          onClick={() => onSelect(selected)}
          className="p-1 text-purple-600 hover:bg-purple-50 rounded transition-colors"
          title="Yonlendir"
        >
          <Ship className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
