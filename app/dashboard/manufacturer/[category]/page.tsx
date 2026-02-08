/**
 * Manufacturer Category Page
 * View and update production for a specific category
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, Save, Calendar } from 'lucide-react';
import { formatMonthValue, parseMonthValue } from '@/lib/monthUtils';

interface Request {
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  marketplaceName: string;
  quantity: number;
  producedQuantity: number | null;
  manufacturerNotes: string | null;
  status: string;
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
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'IN_PRODUCTION', label: 'In Production' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
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

  const monthDate = parseMonthValue(month);
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

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
        console.error('Failed to fetch requests:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchRequests();
  }, [category, month]);

  const updateEditValue = (
    iwasku: string,
    field: 'producedQuantity' | 'manufacturerNotes' | 'status',
    value: any
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

      // Update all requests in this group
      const updatePromises = group.requestIds.map(requestId =>
        fetch(`/api/manufacturer/requests/${requestId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        })
      );

      const responses = await Promise.all(updatePromises);
      const allSuccess = responses.every(r => r.ok);

      if (allSuccess) {
        // Update local state for all requests in the group
        setRequests((prev) =>
          prev.map((r) =>
            group.requestIds.includes(r.id)
              ? {
                  ...r,
                  producedQuantity: values.producedQuantity,
                  manufacturerNotes: values.manufacturerNotes,
                  status: values.status,
                }
              : r
          )
        );
      } else {
        alert('Failed to save some changes');
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save changes');
    } finally {
      setSaving(null);
    }
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
      {/* Back Button */}
      <Link
        href={`/dashboard/month/${month}`}
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {monthLabel}
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
          Enter produced quantities and production notes
        </p>
      </div>

      {/* Requests Table */}
      {groupedRequests.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Package className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600">No production requests for this category in {monthLabel}</p>
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
                    Product Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Requested
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Produced
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Notes
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {groupedRequests.map((group) => (
                  <tr key={group.iwasku} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm font-mono text-gray-900">
                        {group.iwasku}
                      </span>
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
                      <input
                        type="number"
                        min="0"
                        value={editValues[group.iwasku]?.producedQuantity || 0}
                        onChange={(e) =>
                          updateEditValue(group.iwasku, 'producedQuantity', parseInt(e.target.value) || 0)
                        }
                        className="w-24 px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
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
                        placeholder="Production notes..."
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
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="w-3.5 h-3.5" />
                            Save
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
    </div>
  );
}
