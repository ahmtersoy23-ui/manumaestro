/**
 * Transfer Modal — raflar arası tekil ürün veya koli transferi.
 * Aynı depo: herhangi bir raf hedef.
 * Cross-warehouse (NJ ↔ Showroom): yalnız POOL/TEMP rafları hedef.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, ArrowRight, AlertCircle } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('TransferDialog');

interface ShelfOption {
  id: string;
  code: string;
  shelfType: 'POOL' | 'TEMP' | 'NORMAL';
}

export interface TransferSource {
  type: 'stock' | 'box';
  id: string;
  iwasku: string;
  productName?: string | null;
  available: number; // ShelfStock için kullanılabilir; ShelfBox için tüm miktar
  boxNumber?: string | null;
  fromShelfId: string;
  fromShelfCode: string;
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  source: TransferSource | null;
  onClose: () => void;
  onSuccess: () => void;
}

const CROSS_TARGETS: Record<string, string> = {
  NJ: 'SHOWROOM',
  SHOWROOM: 'NJ',
};

export function TransferDialog({ isOpen, warehouseCode, source, onClose, onSuccess }: Props) {
  const [shelves, setShelves] = useState<ShelfOption[]>([]);
  const [crossShelves, setCrossShelves] = useState<ShelfOption[]>([]);
  const [crossEnabled, setCrossEnabled] = useState(false);
  const [toShelfId, setToShelfId] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crossTargetWh = CROSS_TARGETS[warehouseCode];
  const canCross = !!crossTargetWh && source?.type === 'box' || !!crossTargetWh; // her iki tür için açık

  // Modal açılınca raf listelerini yükle
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch(`/api/depolar/${warehouseCode}/raflar`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          // Kaynak rafı çıkar
          setShelves(
            (d.data.shelves || []).filter((s: ShelfOption) => s.id !== source?.fromShelfId)
          );
        }
      })
      .catch((e) => logger.error('Shelves fetch', e));

    if (crossTargetWh) {
      fetch(`/api/depolar/${crossTargetWh}/raflar`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.success) {
            // Sadece POOL ve TEMP
            setCrossShelves(
              (d.data.shelves || []).filter(
                (s: ShelfOption) => s.shelfType === 'POOL' || s.shelfType === 'TEMP'
              )
            );
          }
        })
        .catch((e) => logger.error('Cross shelves fetch', e));
    }

    return () => { cancelled = true; };
  }, [isOpen, warehouseCode, crossTargetWh, source?.fromShelfId]);

  // Source değişince state reset
  useEffect(() => {
    if (!isOpen) return;
    setToShelfId('');
    setQuantity(source?.type === 'stock' ? source.available : '');
    setCrossEnabled(false);
    setError(null);
  }, [isOpen, source]);

  const visibleTargets = useMemo(
    () => (crossEnabled ? crossShelves : shelves),
    [crossEnabled, crossShelves, shelves]
  );

  if (!isOpen || !source) return null;

  const handleSubmit = async () => {
    setError(null);
    if (!toShelfId) return setError('Hedef raf seçin');
    if (source.type === 'stock' && (!quantity || quantity <= 0)) {
      return setError('Miktar pozitif olmalı');
    }
    if (source.type === 'stock' && Number(quantity) > source.available) {
      return setError(`Maksimum ${source.available} adet`);
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/transfer`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: { type: source.type, id: source.id },
          toShelfId,
          quantity: source.type === 'stock' ? Number(quantity) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Transfer başarısız');
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Transfer hatası', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Transfer</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Kaynak banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-3 text-sm">
          <div className="text-xs text-blue-700 mb-1">
            Kaynak: <span className="font-mono">{source.fromShelfCode}</span> ({warehouseCode})
          </div>
          <div className="font-medium text-gray-900 truncate">
            {source.type === 'box' ? `Koli ${source.boxNumber}` : source.iwasku}
          </div>
          {source.productName && (
            <div className="text-xs text-gray-600 truncate">{source.productName}</div>
          )}
          <div className="text-xs text-gray-500 mt-1">
            {source.type === 'box'
              ? `Tüm koli (${source.available} adet) — kısmi transfer için önce parçalayın`
              : `Kullanılabilir: ${source.available} adet`}
          </div>
        </div>

        <div className="space-y-3">
          {/* Cross-warehouse toggle */}
          {canCross && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={crossEnabled}
                onChange={(e) => {
                  setCrossEnabled(e.target.checked);
                  setToShelfId('');
                }}
                className="rounded"
              />
              <span className="text-gray-700">
                Diğer depoya gönder ({crossTargetWh}) — yalnız POOL/TEMP rafları
              </span>
            </label>
          )}

          {/* Hedef raf */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Hedef raf {crossEnabled && `(${crossTargetWh})`}
            </label>
            <select
              value={toShelfId}
              onChange={(e) => setToShelfId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            >
              <option value="">Seçin…</option>
              {visibleTargets.length === 0 ? (
                <option disabled>
                  {crossEnabled
                    ? `${crossTargetWh}'de POOL/TEMP raf yok`
                    : 'Hedef raf yok'}
                </option>
              ) : (
                visibleTargets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} ({s.shelfType})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Miktar — yalnız stock için */}
          {source.type === 'stock' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Miktar</label>
              <input
                type="number"
                min="1"
                max={source.available}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
              />
            </div>
          )}

          {/* Görsel akış */}
          <div className="flex items-center justify-center gap-3 py-2 text-sm text-gray-700">
            <span className="font-mono px-2 py-1 bg-gray-100 rounded">{source.fromShelfCode}</span>
            <ArrowRight className="w-4 h-4 text-gray-400" />
            <span className="font-mono px-2 py-1 bg-blue-50 rounded">
              {visibleTargets.find((s) => s.id === toShelfId)?.code ?? '?'}
            </span>
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
              disabled={submitting || !toShelfId}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            >
              {submitting ? 'Aktarılıyor…' : 'Transfer Et'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
