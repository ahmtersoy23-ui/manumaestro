/**
 * Tekil Ürün Ekle — modal.
 * Bir rafa loose stock (koli wrapper'ı OLMADAN) ekler.
 * Backend: POST /api/depolar/[code]/raflar/[shelfId]/tekil
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Search } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('LooseStockDialog');

interface ProductHit {
  iwasku: string;
  name: string;
  category: string | null;
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  shelfId: string;
  shelfCode: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function LooseStockDialog({
  isOpen,
  warehouseCode,
  shelfId,
  shelfCode,
  onClose,
  onSuccess,
}: Props) {
  const [iwasku, setIwasku] = useState('');
  const [productHits, setProductHits] = useState<ProductHit[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [productDisplay, setProductDisplay] = useState('');

  const [quantity, setQuantity] = useState<number | ''>('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const productInputRef = useRef<HTMLInputElement>(null);

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
    productInputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    const q = productSearchQuery.trim();
    if (q.length < 2) {
      setProductHits([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      fetch(`/api/products/search?q=${encodeURIComponent(q)}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.success) setProductHits(d.data || []);
        })
        .catch((e) => logger.error('Product search', e));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [productSearchQuery]);

  if (!isOpen) return null;

  const selectProduct = (hit: ProductHit) => {
    setIwasku(hit.iwasku);
    setProductDisplay(`${hit.iwasku} — ${hit.name}`);
    setProductSearchQuery('');
    setShowProductDropdown(false);
  };

  const reset = () => {
    setIwasku('');
    setProductDisplay('');
    setProductSearchQuery('');
    setQuantity('');
    setNotes('');
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!iwasku) return setError('Ürün seçin');
    if (!quantity || quantity <= 0) return setError('Adet girin');

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/depolar/${warehouseCode}/raflar/${shelfId}/tekil`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            iwasku,
            quantity: Number(quantity),
            notes: notes.trim() || undefined,
          }),
        }
      );
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
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="loose-stock-dialog-title" className="text-lg font-semibold">
            Tekil Ürün Ekle —{' '}
            <span className="font-mono text-sm text-gray-600">{shelfCode}</span>
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
          <div className="relative">
            <label
              htmlFor="loose-product"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Ürün (SKU/iwasku) *
            </label>
            {productDisplay ? (
              <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-md bg-blue-50 text-sm">
                <span className="font-mono text-xs">{iwasku}</span>
                <span className="text-gray-700 truncate flex-1">
                  {productDisplay.split(' — ')[1]}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIwasku('');
                    setProductDisplay('');
                  }}
                  className="text-xs text-blue-700 hover:underline"
                >
                  Değiştir
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                    aria-hidden="true"
                  />
                  <input
                    ref={productInputRef}
                    id="loose-product"
                    type="text"
                    value={productSearchQuery}
                    onChange={(e) => {
                      setProductSearchQuery(e.target.value);
                      setShowProductDropdown(true);
                    }}
                    onFocus={() => setShowProductDropdown(true)}
                    placeholder="iwasku veya ürün adı yaz (en az 2 karakter)"
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                {showProductDropdown && productHits.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
                    {productHits.map((p) => (
                      <button
                        key={p.iwasku}
                        type="button"
                        onClick={() => selectProduct(p)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="font-mono text-xs text-gray-500">{p.iwasku}</div>
                        <div className="text-gray-800 truncate">{p.name}</div>
                        {p.category && (
                          <div className="text-[10px] text-gray-400">{p.category}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

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
              disabled={submitting || !iwasku || !quantity}
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
