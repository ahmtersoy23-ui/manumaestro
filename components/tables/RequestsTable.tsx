/**
 * Requests Table Component
 * Displays recent production requests for a marketplace
 * With bulk delete functionality and production month display
 */

'use client';

import { useState, useEffect } from 'react';
import { Calendar, Package, Trash2, CheckSquare, Square } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RequestsTable');
const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL || 'https://apps.iwa.web.tr';

interface RequestsTableProps {
  marketplaceId: string;
  month?: string; // Filter by specific month (YYYY-MM format)
  refreshTrigger?: number;
  onDelete?: () => void;
  archiveMode?: boolean;
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
  enteredBy: {
    name: string;
  };
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

  useEffect(() => {
    async function fetchRequests() {
      setLoading(true);
      try {
        const archiveParam = archiveMode ? '&archiveMode=true' : '';
        const monthParam = month && !archiveMode ? `&month=${month}` : '';
        const res = await fetch(`/api/requests?marketplaceId=${marketplaceId}&limit=5000${archiveParam}${monthParam}`);
        const data = await res.json();

        if (data.success) {
          // Sort A-Z by iwasku
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
  }, [marketplaceId, month, refreshTrigger, archiveMode]);

  // Pagination
  const totalPages = Math.ceil(requests.length / PAGE_SIZE);
  const paginatedRequests = requests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    if (!confirm(`${selectedIds.size} talebi silmek istediğinize emin misiniz?`)) {
      return;
    }

    setBulkDeleting(true);
    try {
      // Delete each selected request sequentially to avoid rate limiting
      const failedIds: string[] = [];
      let rateLimited = false;

      for (const id of Array.from(selectedIds)) {
        try {
          const res = await fetch(`/api/requests/${id}`, { method: 'DELETE' });

          if (res.status === 429) {
            rateLimited = true;
            alert('⏳ Rate limit aşıldı. Lütfen birkaç saniye bekleyip tekrar deneyin.');
            break;
          }

          if (res.status === 401) {
            alert('🔒 Oturum süreniz dolmuş. Lütfen yeniden giriş yapın.');
            window.location.href = SSO_URL;
            return;
          }

          if (res.status === 403) {
            alert('⛔ Bu işlem için yetkiniz yok.');
            return;
          }

          const data = await res.json();
          if (!data.success) {
            failedIds.push(id);
          }
        } catch (error) {
          logger.error(`Failed to delete ${id}:`, error);
          failedIds.push(id);
        }
      }

      // Remove successfully deleted items from local state
      const deletedIds = Array.from(selectedIds).filter(id => !failedIds.includes(id));
      setRequests(requests.filter(r => !deletedIds.includes(r.id)));
      setSelectedIds(new Set(failedIds));

      // Show result
      if (failedIds.length > 0 && !rateLimited) {
        alert(`⚠️ ${deletedIds.length} talep silindi, ${failedIds.length} talep silinemedi.`);
      } else if (!rateLimited && deletedIds.length > 0) {
        alert(`✅ ${deletedIds.length} talep başarıyla silindi.`);
      }

      // Trigger parent callback if any were deleted
      if (deletedIds.length > 0 && onDelete) {
        onDelete();
      }
    } catch (error) {
      logger.error('Bulk delete error:', error);
      alert('Toplu silme işlemi başarısız oldu.');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDelete = async (requestId: string) => {
    if (!confirm('Bu talebi silmek istediğinize emin misiniz?')) {
      return;
    }

    setDeleting(requestId);
    try {
      const res = await fetch(`/api/requests/${requestId}`, {
        method: 'DELETE',
      });

      // Handle rate limiting
      if (res.status === 429) {
        const data = await res.json();
        alert('⏳ Çok fazla istek yaptınız. Lütfen birkaç saniye bekleyip tekrar deneyin.');
        return;
      }

      // Handle authentication errors
      if (res.status === 401) {
        alert('🔒 Oturum süreniz dolmuş. Lütfen yeniden giriş yapın.');
        window.location.href = SSO_URL;
        return;
      }

      // Handle authorization errors
      if (res.status === 403) {
        alert('⛔ Bu işlem için yetkiniz yok. Sadece kendi girdiğiniz talepleri silebilirsiniz.');
        return;
      }

      const data = await res.json();

      if (data.success) {
        // Remove from local state
        setRequests(requests.filter(r => r.id !== requestId));

        // Trigger parent callback
        if (onDelete) {
          onDelete();
        }
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
            Henüz talep yok
          </h3>
          <p className="text-sm text-gray-600">
            Yukarıdan ilk üretim talebinizi ekleyerek başlayın
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk Actions Bar */}
      {hasRole(['admin', 'editor']) && selectedIds.size > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-sm font-medium text-purple-900">
            {selectedIds.size} öğe seçildi
          </p>
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
                Seçilenleri Sil
              </>
            )}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <colgroup>
              {hasRole(['admin', 'editor']) && <col className="w-12" />} {/* Checkbox */}
              <col className="w-28" /> {/* Production Month */}
              <col className="w-32" /> {/* Date */}
              <col className="w-36" /> {/* IWASKU */}
              <col className="w-auto" /> {/* Product Name */}
              <col className="w-48" /> {/* Category */}
              <col className="w-24" /> {/* Quantity */}
              <col className="w-24" /> {/* Priority */}
              <col className="w-32" /> {/* Status */}
              {hasRole(['admin', 'editor']) && <col className="w-32" />} {/* Actions */}
            </colgroup>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {hasRole(['admin', 'editor']) && (
                  <th className="px-4 py-3 text-center">
                    <button
                      onClick={handleSelectAll}
                      className="text-gray-600 hover:text-purple-600 transition-colors"
                      title={selectedIds.size === requests.length ? 'Tümünü kaldır' : 'Tümünü seç'}
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
                  Üretim Ayı
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Tarih
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  IWASKU
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Ürün Adı
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Kategori
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Miktar
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Öncelik
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Durum
                </th>
                {hasRole(['admin', 'editor']) && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    İşlem
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {paginatedRequests.map((request) => (
                <tr key={request.id} className={`transition-colors ${selectedIds.has(request.id) ? 'bg-purple-50' : 'hover:bg-gray-50'}`}>
                  {hasRole(['admin', 'editor']) && (
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
                        const [year, month] = request.productionMonth.split('-');
                        return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString('tr-TR', {
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
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    {hasRole(['admin', 'editor']) && (
                      <button
                        onClick={() => handleDelete(request.id)}
                        disabled={deleting === request.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Talebi sil"
                      >
                        {deleting === request.id ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-red-700 border-t-transparent rounded-full animate-spin" />
                          </>
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500">
              {requests.length} talepten {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, requests.length)} gösteriliyor
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-100"
              >
                ‹ Önceki
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
