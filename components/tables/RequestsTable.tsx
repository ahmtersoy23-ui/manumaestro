/**
 * Requests Table Component
 * Displays recent production requests for a marketplace
 */

'use client';

import { useState, useEffect } from 'react';
import { Calendar, Package } from 'lucide-react';

interface RequestsTableProps {
  marketplaceId: string;
  refreshTrigger?: number;
}

interface Request {
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  quantity: number;
  status: string;
  requestDate: string;
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

export function RequestsTable({ marketplaceId, refreshTrigger }: RequestsTableProps) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRequests() {
      setLoading(true);
      try {
        const res = await fetch(`/api/requests?marketplaceId=${marketplaceId}&limit=20`);
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
  }, [marketplaceId, refreshTrigger]);

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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                IWASKU
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Product Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Category
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Quantity
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {requests.map((request) => (
              <tr key={request.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2 text-sm text-gray-900">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    {new Date(request.requestDate).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm font-mono text-gray-900">
                    {request.iwasku}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-gray-900">
                    {request.productName}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-600">
                    {request.productCategory}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm font-semibold text-gray-900">
                    {request.quantity}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      statusColors[request.status as keyof typeof statusColors]
                    }`}
                  >
                    {statusLabels[request.status as keyof typeof statusLabels]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
