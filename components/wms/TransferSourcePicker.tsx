/**
 * Transfer için kaynak seçici — depo lobisinden Transfer butonuyla açılır.
 * 2 adım:
 *   1. iwasku/ürün ara (autocomplete)
 *   2. Seçilen ürünün depodaki tüm konumları (raf+koli) listele → birini seç
 * Seçim sonrası onSelect callback'i ile TransferSource döner;
 * caller mevcut TransferDialog'u o source ile mount eder.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X, AlertCircle, ArrowLeft, Box as BoxIcon, Package } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import type { TransferSource } from '@/components/wms/TransferDialog';

const logger = createLogger('TransferSourcePicker');

interface ProductHit {
  iwasku: string;
  name: string;
  category: string | null;
}

interface StockLoc {
  id: string;
  shelfId: string;
  shelfCode: string;
  shelfType: string;
  quantity: number;
  reservedQty: number;
  availableQty: number;
}

interface BoxLoc {
  id: string;
  shelfId: string;
  shelfCode: string;
  shelfType: string;
  boxNumber: string;
  fnsku: string | null;
  quantity: number;
  reservedQty: number;
  availableQty: number;
  status: string;
}

interface KonumlarResponse {
  iwasku: string;
  productName: string | null;
  stocks: StockLoc[];
  boxes: BoxLoc[];
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  onClose: () => void;
  onSelect: (source: TransferSource) => void;
}

export function TransferSourcePicker({ isOpen, warehouseCode, onClose, onSelect }: Props) {
  const [step, setStep] = useState<'search' | 'pick'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductHit | null>(null);
  const [konumlar, setKonumlar] = useState<KonumlarResponse | null>(null);
  const [loadingKonum, setLoadingKonum] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      // setState'leri async slot'a taşı (React 19 cascade-render guard)
      const t = setTimeout(() => {
        setStep('search');
        setSearchQuery('');
        setHits([]);
        setSelectedProduct(null);
        setKonumlar(null);
        setError(null);
      }, 0);
      return () => clearTimeout(t);
    }
    const f = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(f);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    const q = searchQuery.trim();
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      if (q.length < 2) {
        setHits([]);
        return;
      }
      fetch(`/api/products/search?q=${encodeURIComponent(q)}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.success) setHits(d.data || []);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchQuery]);

  const selectProduct = (p: ProductHit) => {
    setSelectedProduct(p);
    setShowDropdown(false);
    setSearchQuery('');
    setStep('pick');
    setLoadingKonum(true);
    setError(null);
    fetch(
      `/api/depolar/${warehouseCode}/iwasku-konumlar?iwasku=${encodeURIComponent(p.iwasku)}`,
      { credentials: 'include' }
    )
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) {
          setError(d.error || 'Konumlar yüklenemedi');
          return;
        }
        setKonumlar(d.data);
      })
      .catch((e) => {
        logger.error('Konumlar fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => setLoadingKonum(false));
  };

  const back = () => {
    setStep('search');
    setSelectedProduct(null);
    setKonumlar(null);
  };

  const pickStock = (s: StockLoc) => {
    if (!selectedProduct) return;
    onSelect({
      type: 'stock',
      id: s.id,
      iwasku: selectedProduct.iwasku,
      productName: selectedProduct.name,
      available: s.availableQty,
      fromShelfId: s.shelfId,
      fromShelfCode: s.shelfCode,
    });
    onClose();
  };

  const pickBox = (b: BoxLoc) => {
    if (!selectedProduct) return;
    onSelect({
      type: 'box',
      id: b.id,
      iwasku: selectedProduct.iwasku,
      productName: selectedProduct.name,
      available: b.availableQty,
      fromShelfId: b.shelfId,
      fromShelfCode: b.shelfCode,
      boxNumber: b.boxNumber,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            {step === 'pick' && (
              <button
                type="button"
                onClick={back}
                aria-label="Geri"
                className="p-1 hover:bg-gray-100 rounded"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-lg font-semibold">
              Transfer — {step === 'search' ? 'Ürün Seç' : 'Kaynak Konum Seç'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-1 hover:bg-gray-100 rounded"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {step === 'search' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="iwasku veya ürün adı yaz (en az 2 karakter)"
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              {showDropdown && hits.length > 0 && (
                <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {hits.map((p) => (
                    <button
                      key={p.iwasku}
                      type="button"
                      onClick={() => selectProduct(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
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
              {searchQuery.trim().length >= 2 && hits.length === 0 && (
                <div className="text-center text-sm text-gray-400 py-4">
                  Eşleşen ürün yok.
                </div>
              )}
            </div>
          )}

          {step === 'pick' && (
            <div className="space-y-4">
              {selectedProduct && (
                <div className="bg-blue-50 border border-blue-200 rounded p-2">
                  <div className="font-mono text-xs text-gray-600">{selectedProduct.iwasku}</div>
                  <div className="text-sm text-gray-900">{selectedProduct.name}</div>
                </div>
              )}

              {loadingKonum && (
                <div className="text-center py-6 text-gray-500 text-sm">Konumlar yükleniyor…</div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-3 h-3" /> {error}
                </div>
              )}

              {!loadingKonum && konumlar && (
                <>
                  {konumlar.stocks.length === 0 && konumlar.boxes.length === 0 && (
                    <div className="text-center py-6 text-gray-400 text-sm">
                      Bu depoda kullanılabilir konum yok.
                    </div>
                  )}

                  {konumlar.stocks.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                        <Package className="w-3 h-3" /> Tekil ürünler
                      </div>
                      <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
                        {konumlar.stocks.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            disabled={s.availableQty <= 0}
                            onClick={() => pickStock(s)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between"
                          >
                            <span>
                              <span className="font-mono text-xs text-gray-700">{s.shelfCode}</span>
                              <span className="ml-2 text-[10px] uppercase text-gray-500">
                                {s.shelfType}
                              </span>
                            </span>
                            <span className="text-xs text-gray-700">
                              {s.availableQty}
                              {s.reservedQty > 0 && (
                                <span className="ml-1 text-amber-600">
                                  (rezerve {s.reservedQty})
                                </span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {konumlar.boxes.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                        <BoxIcon className="w-3 h-3" /> Koliler
                      </div>
                      <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
                        {konumlar.boxes.map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            disabled={b.availableQty <= 0}
                            onClick={() => pickBox(b)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between"
                          >
                            <span>
                              <span className="font-mono text-xs text-gray-700">{b.boxNumber}</span>
                              <span className="ml-2 text-gray-500 text-xs">@ {b.shelfCode}</span>
                              <span className="ml-2 text-[10px] uppercase text-gray-500">
                                {b.status}
                              </span>
                            </span>
                            <span className="text-xs text-gray-700">{b.availableQty}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
