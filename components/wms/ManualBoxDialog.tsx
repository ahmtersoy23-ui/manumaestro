/**
 * Yeni Koli (Manuel) — modal.
 * Sevkiyat-dışı koli ekler. Synthetic Shipment + ShipmentBox + ShelfBox + Movement log.
 * Backend: POST /api/depolar/[code]/koli
 */

'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { warehouseLabel } from '@/lib/warehouseLabels';
import { ProductSearch, type ProductHit } from '@/components/wms/ProductSearch';

const logger = createLogger('ManualBoxDialog');

interface ShelfOption {
  id: string;
  code: string;
  shelfType: string;
}

interface Marketplace {
  code: string;
  name: string;
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

export function ManualBoxDialog({ isOpen, warehouseCode, fixedShelfId, fixedShelfCode, onClose, onSuccess }: Props) {
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [quantity, setQuantity] = useState<number | ''>('');
  const [marketplaceCode, setMarketplaceCode] = useState('');
  const [destination, setDestination] = useState<'DEPO' | 'FBA' | 'SHOWROOM'>('DEPO');
  const [boxNumber, setBoxNumber] = useState('');
  const [targetShelfId, setTargetShelfId] = useState(fixedShelfId ?? '');

  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
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
    Promise.all([
      fetch('/api/marketplaces', { credentials: 'include' }).then((r) => r.json()),
      fetch(`/api/depolar/${warehouseCode}/raflar`, { credentials: 'include' }).then((r) => r.json()),
    ])
      .then(([mp, sh]) => {
        if (cancelled) return;
        if (mp.success) setMarketplaces(mp.data || []);
        if (sh.success) setShelves(sh.data.shelves || []);
      })
      .catch((e) => logger.error('Modal lookup fetch', e));
    return () => { cancelled = true; };
  }, [isOpen, warehouseCode]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setError(null);
    if (!product) return setError('Ürün seçin');
    const iwasku = product.iwasku;
    if (!quantity || quantity <= 0) return setError('Adet girin');
    if (!marketplaceCode) return setError('Pazaryeri seçin');

    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/koli`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iwasku,
          quantity: Number(quantity),
          marketplaceCode,
          destination,
          boxNumber: boxNumber.trim() || undefined,
          targetShelfId: targetShelfId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Koli yaratılamadı');
        return;
      }
      // Reset + kapat
      setProduct(null);
      setQuantity('');
      setMarketplaceCode('');
      setDestination('DEPO');
      setBoxNumber('');
      setTargetShelfId('');
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Manuel koli hatası', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-box-dialog-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 text-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="manual-box-dialog-title" className="text-lg font-semibold">Yeni Koli (Manuel) — {warehouseLabel(warehouseCode)}</h2>
          <button type="button" onClick={onClose} aria-label="Kapat" className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Ürün (SKU/iwasku) *</label>
            <ProductSearch
              selected={product}
              onSelect={setProduct}
              onClear={() => setProduct(null)}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="manual-box-quantity" className="block text-xs font-medium text-gray-700 mb-1">Adet *</label>
              <input
                id="manual-box-quantity"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
              />
            </div>
            <div role="group" aria-label="Hedef">
              <span className="block text-xs font-medium text-gray-700 mb-1">Hedef</span>
              <div className="flex gap-1">
                {(['DEPO', 'FBA', 'SHOWROOM'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDestination(d)}
                    aria-pressed={destination === d}
                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium ${
                      destination === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="manual-box-marketplace" className="block text-xs font-medium text-gray-700 mb-1">Pazaryeri *</label>
            <select
              id="manual-box-marketplace"
              value={marketplaceCode}
              onChange={(e) => setMarketplaceCode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            >
              <option value="">Seçin…</option>
              {marketplaces.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code} — {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="manual-box-number" className="block text-xs font-medium text-gray-700 mb-1">
                Koli no (opsiyonel)
              </label>
              <input
                id="manual-box-number"
                type="text"
                value={boxNumber}
                onChange={(e) => setBoxNumber(e.target.value)}
                placeholder="boş = MAN-{depo}-N"
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label htmlFor="manual-box-target-shelf" className="block text-xs font-medium text-gray-700 mb-1">
                {fixedShelfId ? 'Hedef raf' : 'Hedef raf (opsiyonel)'}
              </label>
              {fixedShelfId ? (
                <div className="px-3 py-2 border border-gray-200 rounded-md text-sm bg-gray-50 font-mono">
                  {fixedShelfCode ?? fixedShelfId}
                </div>
              ) : (
                <select
                  id="manual-box-target-shelf"
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

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">{error}</div>
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
              disabled={submitting || !product || !quantity || !marketplaceCode}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            >
              {submitting ? 'Yaratılıyor…' : 'Koli Yarat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
