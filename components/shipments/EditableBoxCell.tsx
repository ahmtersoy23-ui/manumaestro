'use client';

/**
 * Sevkiyat detay: koli boyut/ağırlık inline edit cell (Tab navigation ile).
 * Tab → sonraki kolon, Shift+Tab → önceki kolon. Enter → save + next.
 * Escape → iptal. Blur → save (unless tab navigating).
 * shipments/[id]/page.tsx'ten ayrıldı.
 */

import { useState, useEffect, useRef } from 'react';
import type { ShipmentBox } from '@/lib/shipments/types';

export const FIELD_ORDER: ('width' | 'depth' | 'height' | 'weight')[] = ['width', 'depth', 'height', 'weight'];

export type CellField = 'width' | 'depth' | 'height' | 'weight';

interface Props {
  boxId: string;
  shipmentId: string;
  field: CellField;
  value: number | null;
  canEdit: boolean;
  onUpdated: () => void;
  editingCell: { boxId: string; field: CellField } | null;
  setEditingCell: (cell: { boxId: string; field: CellField } | null) => void;
  visibleBoxes: ShipmentBox[];
}

export function EditableBoxCell({
  boxId,
  shipmentId,
  field,
  value,
  canEdit,
  onUpdated,
  editingCell,
  setEditingCell,
  visibleBoxes,
}: Props) {
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);
  const tabNavigating = useRef(false);
  const isEditing = editingCell?.boxId === boxId && editingCell?.field === field;

  useEffect(() => {
    if (isEditing) setInputVal(value?.toString() ?? '');
  }, [isEditing, value]);

  const navigateCell = (direction: 1 | -1) => {
    const fieldIdx = FIELD_ORDER.indexOf(field);
    const boxIdx = visibleBoxes.findIndex(b => b.id === boxId);
    let nextField = fieldIdx + direction;
    let nextBoxIdx = boxIdx;
    if (nextField >= FIELD_ORDER.length) { nextField = 0; nextBoxIdx++; }
    else if (nextField < 0) { nextField = FIELD_ORDER.length - 1; nextBoxIdx--; }
    if (nextBoxIdx >= 0 && nextBoxIdx < visibleBoxes.length) {
      setEditingCell({ boxId: visibleBoxes[nextBoxIdx].id, field: FIELD_ORDER[nextField] });
    } else {
      setEditingCell(null);
    }
  };

  const handleSave = async (andNavigate?: 1 | -1) => {
    const num = inputVal.trim() ? parseFloat(inputVal) : null;
    if (num !== null && (isNaN(num) || num <= 0)) {
      if (andNavigate) navigateCell(andNavigate); else setEditingCell(null);
      return;
    }
    if (num === value) {
      if (andNavigate) navigateCell(andNavigate); else setEditingCell(null);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/boxes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId, [field]: num }),
      });
      if ((await res.json()).success) onUpdated();
    } catch {
      // sessizce yut — kullanıcı Tab/Enter ile devam edebilir
    } finally {
      setSaving(false);
      if (andNavigate) navigateCell(andNavigate); else setEditingCell(null);
    }
  };

  if (!canEdit) {
    return <td className="text-center px-3 py-3 text-gray-600">{value ?? '—'}</td>;
  }

  if (isEditing) {
    return (
      <td className="text-center px-1 py-1">
        <input
          type="number"
          step="0.1"
          autoFocus
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Tab') {
              e.preventDefault();
              tabNavigating.current = true;
              handleSave(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Enter') {
              tabNavigating.current = true;
              handleSave(1);
            } else if (e.key === 'Escape') {
              setEditingCell(null);
            }
          }}
          onBlur={() => {
            if (!saving && !tabNavigating.current) handleSave();
            tabNavigating.current = false;
          }}
          disabled={saving}
          className="w-14 px-1 py-0.5 border border-blue-300 rounded text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </td>
    );
  }

  return (
    <td
      className="text-center px-3 py-3 text-gray-600 cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition-colors"
      onClick={() => setEditingCell({ boxId, field })}
      title="Düzenlemek için tıkla"
    >
      {value ?? '—'}
    </td>
  );
}
