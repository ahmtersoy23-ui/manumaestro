/**
 * Parçala Modal — koliden kısmi miktar alıp aynı raftaki ShelfStock'a aktarır.
 * Backend: POST /api/depolar/[code]/koli/[boxId]/break
 */

'use client';

import { useState, useEffect } from 'react';
import { X, AlertCircle, Scissors } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('BreakBoxDialog');

export interface BreakBoxSource {
  id: string;
  boxNumber: string;
  iwasku: string;
  productName?: string | null;
  available: number; // quantity - reservedQty
  reservedQty: number;
  shelfCode: string;
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  source: BreakBoxSource | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function BreakBoxDialog({ isOpen, warehouseCode, source, onClose, onSuccess }: Props) {
  const [quantity, setQuantity] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuantity('');
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen || !source) return null;

  const handleSubmit = async () => {
    setError(null);
    if (!quantity || quantity <= 0) return setError('Pozitif bir miktar girin');
    if (quantity > source.available) return setError(`Maksimum ${source.available} adet`);

    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/koli/${source.id}/break`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: Number(quantity) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'İşlem başarısız');
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Break box hatası', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Scissors className="w-4 h-4 text-amber-600" /> Koli Parçala
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Kaynak banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-3 text-sm">
          <div className="text-xs text-amber-700 mb-1">
            Raf <span className="font-mono">{source.shelfCode}</span> — Koli <span className="font-mono">{source.boxNumber}</span>
          </div>
          <div className="font-mono text-xs text-gray-700">{source.iwasku}</div>
          {source.productName && (
            <div className="text-xs text-gray-600 truncate">{source.productName}</div>
          )}
          <div className="text-xs text-gray-500 mt-1">
            Kullanılabilir: {source.available}
            {source.reservedQty > 0 && ` (rezerve: ${source.reservedQty})`}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Alınacak miktar
            </label>
            <input
              type="number"
              min="1"
              max={source.available}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
              autoFocus
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Alınan miktar aynı raftaki tekil ürün listesine eklenir. Koli {source.available - (Number(quantity) || 0) === 0 ? 'EMPTY' : 'PARTIAL'} olur.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-3 h-3" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              disabled={submitting}
            >
              İptal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !quantity}
              className="px-3 py-1.5 text-sm text-white bg-amber-600 hover:bg-amber-700 rounded-md disabled:opacity-50"
            >
              {submitting ? 'Aktarılıyor…' : 'Parçala'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
