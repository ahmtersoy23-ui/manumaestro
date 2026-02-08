/**
 * Requests Table Component
 * Displays recent production requests for a marketplace
 * With bulk delete functionality and production month display
 */

'use client';

import { useState, useEffect } from 'react';
import { Calendar, Package, Trash2, CheckSquare, Square } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface RequestsTableProps {
  marketplaceId: string;
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
  requestDate: string;
  createdAt: string;
  notes: string | null;
  enteredBy: {
    name: string;
  };
}

const statusColors = {
  REQUESTED: 'bg-blue-100 text-blue-700',
  IN_PRODUCTION: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-700',
};

const statusLabels = {
  REQUESTED: 'Requested',
  IN_PRODUCTION: 'In Production',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function RequestsTable({ marketplaceId, refreshTrigger, onDelete, archiveMode = false }: RequestsTableProps) {
  const { role, hasRole } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    async function fetchRequests() {
      setLoading(true);
      try {
        const archiveParam = archiveMode ? '&archiveMode=true' : '';
        const res = await fetch(`/api/requests?marketplaceId=${marketplaceId}&limit=100${archiveParam}`);
        const data = await res.json();

        if (data.success) {
          setRequests(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch requests:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchRequests();
    setSelectedIds(new Set()); // Clear selection on refresh
  }, [marketplaceId, refreshTrigger, archiveMode]);

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

    if (!confirm(`Are you sure you want to delete ${selectedIds.size} request(s)?`)) {
      return;
    }

    setBulkDeleting(true);
    try {
      // Delete each selected request
      const deletePromises = Array.from(selectedIds).map(id =>
        fetch(`/api/requests/${id}`, { method: 'DELETE' })
      );

      await Promise.all(deletePromises);

      // Remove deleted items from local state
      setRequests(requests.filter(r => !selectedIds.has(r.id)));
      setSelectedIds(new Set());

      // Trigger parent callback
      if (onDelete) {
        onDelete();
      }
    } catch (error) {
      console.error('Bulk delete error:', error);
      alert('Failed to delete some requests');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDelete = async (requestId: string) => {
    if (!confirm('Are you sure you want to delete this request?')) {
      return;
    }

    setDeleting(requestId);
    try {
      const res = await fetch(`/api/requests/${requestId}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (data.success) {
        // Remove from local state
        setRequests(requests.filter(r => r.id !== requestId));

        // Trigger parent callback
        if (onDelete) {
          onDelete();
        }
      } else {
        alert(data.error || 'Failed to delete request');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete request');
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
            No requests yet
          </h3>
          <p className="text-sm text-gray-600">
            Start by adding your first production request above
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk Actions Bar */}
      {hasRole(['admin']) && selectedIds.size > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-sm font-medium text-purple-900">
            {selectedIds.size} item(s) selected
          </p>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {bulkDeleting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Delete Selected
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
              {hasRole(['admin']) && <col className="w-12" />} {/* Checkbox */}
              <col className="w-28" /> {/* Production Month */}
              <col className="w-32" /> {/* Date */}
              <col className="w-36" /> {/* IWASKU */}
              <col className="w-auto" /> {/* Product Name */}
              <col className="w-48" /> {/* Category */}
              <col className="w-24" /> {/* Quantity */}
              <col className="w-32" /> {/* Status */}
              {hasRole(['admin']) && <col className="w-32" />} {/* Actions */}
            </colgroup>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {hasRole(['admin']) && (
                  <th className="px-4 py-3 text-center">
                    <button
                      onClick={handleSelectAll}
                      className="text-gray-600 hover:text-purple-600 transition-colors"
                      title={selectedIds.size === requests.length ? 'Deselect all' : 'Select all'}
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
                  Production Month
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  IWASKU
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Product Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Quantity
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Status
                </th>
                {hasRole(['admin']) && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {requests.map((request) => (
                <tr key={request.id} className={`transition-colors ${selectedIds.has(request.id) ? 'bg-purple-50' : 'hover:bg-gray-50'}`}>
                  {hasRole(['admin']) && (
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
                      {new Date(request.requestDate).toLocaleDateString('en-US', {
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-sm text-gray-900">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      {new Date(request.createdAt).toLocaleDateString('en-US', {
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
                    <div className="text-sm text-gray-900 truncate" title={request.productName}>
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
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        statusColors[request.status as keyof typeof statusColors]
                      }`}
                    >
                      {statusLabels[request.status as keyof typeof statusLabels]}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    {hasRole(['admin']) && (
                      <button
                        onClick={() => handleDelete(request.id)}
                        disabled={deleting === request.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Delete request"
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
      </div>
    </div>
  );
}
