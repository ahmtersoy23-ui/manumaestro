/**
 * Workflow Kanban Board
 * Category-specific workflow management with drag-and-drop kanban view
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package } from 'lucide-react';
import { formatMonthValue, parseMonthValue } from '@/lib/monthUtils';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCenter, useDroppable, useDraggable } from '@dnd-kit/core';

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
  { stage: 'REQUESTED', label: 'Talep Geldi', color: 'bg-gray-100 border-gray-300 text-gray-700' },
  { stage: 'CUTTING', label: 'Kesim', color: 'bg-blue-100 border-blue-300 text-blue-700' },
  { stage: 'ASSEMBLY', label: 'Montaj', color: 'bg-purple-100 border-purple-300 text-purple-700' },
  { stage: 'QUALITY_CHECK', label: 'Kalite Kontrol', color: 'bg-yellow-100 border-yellow-300 text-yellow-700' },
  { stage: 'PACKAGING', label: 'Paketleme', color: 'bg-orange-100 border-orange-300 text-orange-700' },
  { stage: 'READY_TO_SHIP', label: 'Sevk Hazır', color: 'bg-green-100 border-green-300 text-green-700' },
];

export default function WorkflowKanbanPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const category = decodeURIComponent(params.category as string);
  const month = searchParams.get('month') || formatMonthValue(new Date());

  const [columns, setColumns] = useState<StageColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCard, setActiveCard] = useState<Request | null>(null);

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
    console.log('🔄 Updating workflow:', { requestId, newStage });
    try {
      const res = await fetch('/api/workflow', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, workflowStage: newStage }),
      });

      console.log('📡 API Response status:', res.status);
      const data = await res.json();
      console.log('📦 API Response data:', data);

      if (data.success) {
        console.log('✅ Update successful! Optimistic update will persist.');
        // Don't refresh data - the optimistic update is correct
      } else {
        console.error('❌ Failed to update:', data.error);
        alert('Failed to update workflow stage: ' + (data.error || 'Unknown error'));
        // Revert optimistic update by fetching fresh data
        fetchData();
      }
    } catch (error) {
      console.error('❌ Failed to update stage:', error);
      alert('Failed to update workflow stage');
      // Revert optimistic update by fetching fresh data
      fetchData();
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const requestId = event.active.id as string;
    // Find the request in columns
    for (const column of columns) {
      const request = column.requests.find(r => r.id === requestId);
      if (request) {
        setActiveCard(request);
        break;
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCard(null);

    console.log('🎯 Drag ended:', { activeId: active.id, overId: over?.id });

    if (!over) {
      console.log('⚠️ No drop target');
      return;
    }

    const requestId = active.id as string;
    let targetStage = over.id as string;

    // Check if over.id is a valid stage, if not it might be a card ID
    // In that case, find which column the card belongs to
    const validStages = WORKFLOW_STAGES.map(s => s.stage);
    console.log('🔍 Valid stages:', validStages);
    console.log('🔍 Initial target:', targetStage);

    if (!validStages.includes(targetStage)) {
      console.log('⚠️ Target is not a valid stage, finding parent column...');
      // over.id is a card ID, find its column
      for (const column of columns) {
        if (column.requests.some(r => r.id === targetStage)) {
          targetStage = column.stage;
          console.log('✅ Found parent column:', targetStage);
          break;
        }
      }
    }

    // Find current stage
    let currentStage = '';
    for (const column of columns) {
      if (column.requests.some(r => r.id === requestId)) {
        currentStage = column.stage;
        break;
      }
    }

    console.log('📍 Moving from', currentStage, 'to', targetStage);

    if (currentStage !== targetStage) {
      console.log('🔄 Updating UI optimistically...');
      // Optimistically update UI
      setColumns(prev => {
        const newColumns = prev.map(col => ({ ...col, requests: [...col.requests] }));

        // Remove from current stage
        const fromColumn = newColumns.find(c => c.stage === currentStage);
        const toColumn = newColumns.find(c => c.stage === targetStage);

        if (fromColumn && toColumn) {
          const requestIndex = fromColumn.requests.findIndex(r => r.id === requestId);
          if (requestIndex !== -1) {
            const [request] = fromColumn.requests.splice(requestIndex, 1);
            request.workflowStage = targetStage;
            toColumn.requests.push(request);
            console.log('✅ Optimistic update complete');
          }
        }

        return newColumns;
      });

      // Update on server
      updateWorkflowStage(requestId, targetStage);
    } else {
      console.log('⏭️ Same stage, skipping update');
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
          Drag and drop cards to move them through workflow stages
        </p>
      </div>

      {/* Kanban Board */}
      <DndContext
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <KanbanColumn
              key={column.stage}
              column={column}
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard ? (
            <RequestCard request={activeCard} isDragging />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// Kanban Column Component
function KanbanColumn({ column }: { column: StageColumn }) {
  const { setNodeRef } = useDroppable({
    id: column.stage,
  });

  return (
    <div
      ref={setNodeRef}
      className="flex-shrink-0 w-80"
    >
      {/* Column Header */}
      <div className={`rounded-t-lg border-2 ${column.color} p-4`}>
        <h3 className="font-semibold">{column.label}</h3>
        <p className="text-sm mt-1 opacity-80">{column.requests.length} items</p>
      </div>

      {/* Cards */}
      <div className="bg-gray-50 border-2 border-t-0 border-gray-200 rounded-b-lg p-2 min-h-[400px] space-y-2">
        {column.requests.map((request) => (
          <DraggableCard key={request.id} request={request} />
        ))}
      </div>
    </div>
  );
}

// Draggable Card Component
function DraggableCard({ request }: { request: Request }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: request.id,
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
    >
      <RequestCard request={request} isDragging={isDragging} />
    </div>
  );
}

// Request Card Component
function RequestCard({ request, isDragging }: { request: Request; isDragging?: boolean }) {
  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 p-4 cursor-move hover:shadow-md hover:border-purple-300 transition-all ${
        isDragging ? 'shadow-xl' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-gray-400" />
          <p className="text-sm font-semibold text-gray-900">{request.productName}</p>
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-2">SKU: {request.iwasku}</p>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">Quantity:</span>
        <span className="font-medium text-gray-900">{request.quantity}</span>
      </div>
      <p className="text-xs text-gray-500 mt-2">{request.marketplaceName}</p>
    </div>
  );
}
