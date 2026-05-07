/**
 * Tekil Ürün Ekle — modal.
 * Bir rafa loose stock (koli wrapper'ı OLMADAN) ekler. Hedef raf seçilmezse
 * POOL'a düşer (Manuel Koli ile simetrik).
 * Backend: POST /api/depolar/[code]/tekil
 */

'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { warehouseLabel } from '@/lib/warehouseLabels';
import { ProductSearch, type ProductHit } from '@/components/wms/ProductSearch';

const logger = createLogger('LooseStockDialog');

interface ShelfOption {
  id: string;
  code: string;
  shelfType: string;
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  /** Raf detayından açıldıysa hedef raf preset olur ve dropdown gizlenir */
  fixedShelfId?: string;
  fixedShelfCode?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function LooseStockDialog({ isOpen, warehouseCode, fixedShelfId, fixedShelfCode, onClose, onSuccess }: Props) {
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [quantity, setQuantity] = useState<number | ''>('');
  const [targetShelfId, setTargetShelfId] = useState(fixedShelfId ?? '');
  const [notes, setNotes] = useState('');

  const [shelves, setShelves] = useState<ShelfOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch(`/api/depolar/${warehouseCode}/raflar`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setShelves(d.data.shelves || []);
      })
      .catch((e) => logger.error('Raf fetch', e));
    return () => {
      cancelled = true;
    };
  }, [isOpen, warehouseCode]);

  if (!isOpen) return null;

  const reset = () => {
    setProduct(null);
    setQuantity('');
    setTargetShelfId('');
    setNotes('');
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!product) return setError('Ürün seçin');
    const iwasku = product.iwasku;
    if (!quantity || quantity <= 0) return setError('Adet girin');

    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/tekil`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iwasku,
          quantity: Number(quantity),
          targetShelfId: targetShelfId || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Ekleme başarısız');
        return;
      }
      reset();
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Tekil ekleme hatası', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="loose-stock-dialog-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 text-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="loose-stock-dialog-title" className="text-lg font-semibold">
            Tekil Ürün Ekle — {warehouseLabel(warehouseCode)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-1 hover:bg-gray-100 rounded"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Ürün (SKU/iwasku) *
            </label>
            <ProductSearch
              selected={product}
              onSelect={setProduct}
              onClear={() => setProduct(null)}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="loose-quantity"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                Adet *
              </label>
              <input
                id="loose-quantity"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) =>
                  setQuantity(e.target.value === '' ? '' : Number(e.target.value))
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label
                htmlFor="loose-target-shelf"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                {fixedShelfId ? 'Hedef raf' : 'Hedef raf (opsiyonel)'}
              </label>
              {fixedShelfId ? (
                <div className="px-3 py-2 border border-gray-200 rounded-md text-sm bg-gray-50 font-mono">
                  {fixedShelfCode ?? fixedShelfId}
                </div>
              ) : (
                <select
                  id="loose-target-shelf"
                  value={targetShelfId}
                  onChange={(e) => setTargetShelfId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
                >
                  <option value="">POOL (varsayılan)</option>
                  {shelves.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} ({s.shelfType})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="loose-notes"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Not (opsiyonel)
            </label>
            <input
              id="loose-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              placeholder="Açıklama / kaynak"
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">
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
              disabled={submitting || !product || !quantity}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            >
              {submitting ? 'Ekleniyor…' : 'Ekle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
