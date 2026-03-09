/**
 * Manufacturer Category Page
 * View and update production for a specific category
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, Save, Calendar, Store } from 'lucide-react';
import { formatMonthValue, parseMonthValue } from '@/lib/monthUtils';
import { createLogger } from '@/lib/logger';
import { ProductMarketplaceModal } from '@/components/modals/ProductMarketplaceModal';

const logger = createLogger('ManufacturerCategoryPage');

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
  marketplaceName: string;
  marketplaceColorTag?: string | null;
  quantity: number;
  producedQuantity: number | null;
  manufacturerNotes: string | null;
  status: string;
  priority: string;
  requestDate: string;
}

interface GroupedRequest {
  iwasku: string;
  productName: string;
  totalQuantity: number;
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

  const monthDate = parseMonthValue(month);
  const monthLabel = monthDate.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

  useEffect(() => {
    async function fetchRequests() {
      setLoading(true);
      try {
        const res = await fetch(`/api/manufacturer/category/${encodeURIComponent(category)}?month=${month}`);
        const data = await res.json();

        if (data.success) {
          setRequests(data.data);

          // Group by IWASKU
          const grouped = data.data.reduce((acc: GroupedRequest[], request: Request) => {
            const existing = acc.find(g => g.iwasku === request.iwasku);
            if (existing) {
              existing.totalQuantity += request.quantity;
              existing.requestIds.push(request.id);
              existing.requests.push(request);
            } else {
              acc.push({
                iwasku: request.iwasku,
                productName: request.productName,
                totalQuantity: request.quantity,
                requestIds: [request.id],
                requests: [request],
              });
            }
            return acc;
          }, []);

          setGroupedRequests(grouped);

          // Initialize edit values using first request of each group
          const initialValues: EditValues = {};
          grouped.forEach((group: GroupedRequest) => {
            const firstRequest = group.requests[0];
            // Use the group's IWASKU as the key for editing
            initialValues[group.iwasku] = {
              producedQuantity: firstRequest.producedQuantity || 0,
              manufacturerNotes: firstRequest.manufacturerNotes || '',
              status: firstRequest.status,
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
  }, [category, month]);

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

      // Distribute total produced quantity proportionally across marketplace requests
      // Example: If A requested 50, B requested 100 (total 150), and 120 were produced:
      // A gets (50/150) * 120 = 40, B gets (100/150) * 120 = 80
      const updatePromises = group.requests.map(request => {
        const proportion = group.totalQuantity > 0
          ? request.quantity / group.totalQuantity
          : 0;
        const proportionalProducedQty = Math.round(totalProducedQuantity * proportion);

        return fetch(`/api/manufacturer/requests/${request.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: values.status,
            manufacturerNotes: values.manufacturerNotes,
            producedQuantity: proportionalProducedQty,
          }),
        });
      });

      const responses = await Promise.all(updatePromises);
      const allSuccess = responses.every(r => r.ok);

      if (allSuccess) {
        // Parse all responses to get each request's updated data
        const responsesData = await Promise.all(
          responses.map(r => r.json())
        );

        // Create a map of requestId -> updated data
        const updatedDataMap = new Map(
          responsesData.map(data => [data.data.id, data.data])
        );

        // Update local state for all requests with their individual backend responses
        setRequests((prev) =>
          prev.map((r) => {
            const updated = updatedDataMap.get(r.id);
            return updated
              ? {
                  ...r,
                  producedQuantity: updated.producedQuantity,
                  manufacturerNotes: updated.manufacturerNotes,
                  status: updated.status,
                }
              : r;
          })
        );

        // Calculate total produced for this group (sum of all requests)
        const totalProduced = Array.from(updatedDataMap.values())
          .reduce((sum, data) => sum + (data.producedQuantity || 0), 0);

        // Update editValues to reflect the aggregate values
        setEditValues(prevValues => ({
          ...prevValues,
          [iwasku]: {
            ...prevValues[iwasku],
            producedQuantity: totalProduced,
            manufacturerNotes: values.manufacturerNotes,
            status: values.status,
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
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Package className="w-8 h-8 text-orange-600" />
          <h1 className="text-3xl font-bold text-gray-900">{category}</h1>
        </div>
        <div className="flex items-center gap-2 text-gray-600">
          <Calendar className="w-4 h-4" />
          <p>{monthLabel}</p>
        </div>
        <p className="text-gray-600 mt-2">
          Üretilen miktarları ve üretim notlarını girin
        </p>
      </div>

      {/* Requests Table */}
      {groupedRequests.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Package className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600">{monthLabel} ayında bu kategori için üretim talebi bulunmuyor</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Üretilen
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
                {groupedRequests.map((group) => (
                  <tr key={group.iwasku} className="hover:bg-gray-50">
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
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          value={editValues[group.iwasku]?.producedQuantity || 0}
                          onChange={(e) => updateEditValue(group.iwasku, 'producedQuantity', parseInt(e.target.value) || 0)}
                          min="0"
                          className="w-20 px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        />
                        {editValues[group.iwasku]?.status === 'COMPLETED' && (
                          <span className="text-xs text-green-600">Otomatik tamamlandı</span>
                        )}
                      </div>
                    </td>                    <td className="px-4 py-3 whitespace-nowrap">
                      <select
                        value={editValues[group.iwasku]?.status || group.requests[0].status}
                        onChange={(e) => updateEditValue(group.iwasku, 'status', e.target.value)}
                        className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      >
                        {statusOptions.map((option) => (
                          <option key={option.value} value={option.value} className="text-gray-900">
                            {option.label}
                          </option>
                        ))}
                      </select>
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
                ))}
              </tbody>
            </table>
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
          } else {
            acc.push({ marketplaceName: r.marketplaceName, quantity: r.quantity, colorTag: r.marketplaceColorTag, priority: pri });
          }
          return acc;
        }, [] as Array<{ marketplaceName: string; quantity: number; colorTag?: string | null; priority: string }>) || []}
      />
    </div>
  );
}
