/**
 * Workflow Kanban Board
 * Category-specific workflow management with kanban view
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, ChevronRight } from 'lucide-react';
import { formatMonthValue, parseMonthValue } from '@/lib/monthUtils';

interface Request {
  id: string;
  iwasku: string;
  productName: string;
  quantity: number;
  producedQuantity: number | null;
  workflowStage: string | null;
  marketplaceName: string;
}

interface StageColumn {
  stage: string;
  label: string;
  color: string;
  requests: Request[];
}

const WORKFLOW_STAGES = [
  { stage: 'REQUESTED', label: 'Talep Geldi', color: 'bg-gray-100 border-gray-300' },
  { stage: 'CUTTING', label: 'Kesim', color: 'bg-blue-100 border-blue-300' },
  { stage: 'ASSEMBLY', label: 'Montaj', color: 'bg-purple-100 border-purple-300' },
  { stage: 'QUALITY_CHECK', label: 'Kalite Kontrol', color: 'bg-yellow-100 border-yellow-300' },
  { stage: 'PACKAGING', label: 'Paketleme', color: 'bg-orange-100 border-orange-300' },
  { stage: 'READY_TO_SHIP', label: 'Sevk Hazır', color: 'bg-green-100 border-green-300' },
];

export default function WorkflowKanbanPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const category = decodeURIComponent(params.category as string);
  const month = searchParams.get('month') || formatMonthValue(new Date());

  const [columns, setColumns] = useState<StageColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [showStageModal, setShowStageModal] = useState(false);

  const monthDate = parseMonthValue(month);
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  useEffect(() => {
    fetchData();
  }, [category, month]);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/manufacturer/category/${encodeURIComponent(category)}?month=${month}`);
      const data = await res.json();

      if (data.success) {
        // Group requests by workflow stage
        const grouped = WORKFLOW_STAGES.map(stage => ({
          ...stage,
          requests: data.data.filter((r: Request) =>
            (r.workflowStage || 'REQUESTED') === stage.stage
          ),
        }));

        setColumns(grouped);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function updateWorkflowStage(requestId: string, newStage: string) {
    try {
      const res = await fetch('/api/workflow', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, workflowStage: newStage }),
      });

      const data = await res.json();

      if (data.success) {
        fetchData(); // Refresh data
        setShowStageModal(false);
        setSelectedRequest(null);
      }
    } catch (error) {
      console.error('Failed to update stage:', error);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading workflow...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link
        href={`/dashboard/month/${month}`}
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {monthLabel}
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{category} - Workflow</h1>
        <p className="text-gray-600 mt-1">
          Track production progress through workflow stages
        </p>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <div
            key={column.stage}
            className="flex-shrink-0 w-80"
          >
            {/* Column Header */}
            <div className={`rounded-t-lg border-2 ${column.color} p-4`}>
              <h3 className="font-semibold text-gray-900">{column.label}</h3>
              <p className="text-sm text-gray-600 mt-1">{column.requests.length} items</p>
            </div>

            {/* Cards */}
            <div className="bg-gray-50 border-2 border-t-0 border-gray-200 rounded-b-lg p-2 min-h-[400px] space-y-2">
              {column.requests.map((request) => (
                <button
                  key={request.id}
                  onClick={() => {
                    setSelectedRequest(request);
                    setShowStageModal(true);
                  }}
                  className="w-full bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-purple-300 transition-all text-left"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-gray-400" />
                      <p className="text-sm font-semibold text-gray-900">{request.productName}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </div>
                  <p className="text-xs text-gray-500 mb-2">SKU: {request.iwasku}</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Quantity:</span>
                    <span className="font-medium text-gray-900">{request.quantity}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">{request.marketplaceName}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Stage Change Modal */}
      {showStageModal && selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Change Workflow Stage</h2>
              <p className="text-sm text-gray-600 mt-1">{selectedRequest.productName}</p>
            </div>

            <div className="p-6 space-y-2">
              {WORKFLOW_STAGES.map((stage) => (
                <button
                  key={stage.stage}
                  onClick={() => updateWorkflowStage(selectedRequest.id, stage.stage)}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 ${stage.color} hover:shadow-md transition-all ${
                    (selectedRequest.workflowStage || 'REQUESTED') === stage.stage
                      ? 'ring-2 ring-purple-500'
                      : ''
                  }`}
                >
                  <p className="font-medium text-gray-900">{stage.label}</p>
                </button>
              ))}
            </div>

            <div className="p-6 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowStageModal(false);
                  setSelectedRequest(null);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
