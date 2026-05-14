/**
 * Transfer için kaynak seçici — depo lobisinden Transfer butonuyla açılır.
 * 2 adım:
 *   1. Raf seç (depodaki içerikli raflar listelenir, kod/tür ile filtrelenir)
 *   2. Seçilen rafın tekil ürünleri + kolileri listelenir → birini seç
 * Seçim sonrası onSelect callback'i ile TransferSource döner;
 * caller mevcut TransferDialog'u o source ile mount eder.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, ArrowLeft, Box as BoxIcon, Package, Search } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import type { TransferSource } from '@/components/wms/TransferDialog';

const logger = createLogger('TransferSourcePicker');

interface ShelfSummary {
  id: string;
  code: string;
  shelfType: 'POOL' | 'TEMP' | 'NORMAL';
  summary: {
    looseLines: number;
    looseQty: number;
    looseReserved: number;
    sealedBoxes: number;
    sealedQty: number;
    partialBoxes: number;
    partialQty: number;
  };
}

interface StockRow {
  id: string;
  iwasku: string;
  productName: string | null;
  quantity: number;
  reservedQty: number;
  availableQty: number;
}

interface BoxRow {
  id: string;
  boxNumber: string;
  iwasku: string;
  productName: string | null;
  fnsku: string | null;
  quantity: number;
  reservedQty: number;
  availableQty: number;
  status: string;
}

interface ShelfDetail {
  shelf: { id: string; code: string; shelfType: string };
  stocks: StockRow[];
  boxes: BoxRow[];
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  onClose: () => void;
  onSelect: (source: TransferSource) => void;
}

export function TransferSourcePicker({ isOpen, warehouseCode, onClose, onSelect }: Props) {
  const [step, setStep] = useState<'shelf' | 'pick'>('shelf');
  const [shelves, setShelves] = useState<ShelfSummary[]>([]);
  const [loadingShelves, setLoadingShelves] = useState(false);
  const [shelfQuery, setShelfQuery] = useState('');
  const [shelfTypeFilter, setShelfTypeFilter] = useState<'ALL' | 'POOL' | 'TEMP' | 'NORMAL'>('ALL');
  const [selectedShelf, setSelectedShelf] = useState<ShelfSummary | null>(null);
  const [detail, setDetail] = useState<ShelfDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setStep('shelf');
        setSelectedShelf(null);
        setDetail(null);
        setShelfQuery('');
        setShelfTypeFilter('ALL');
        setError(null);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Raf listesi
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      setLoadingShelves(true);
      setError(null);
      fetch(`/api/depolar/${warehouseCode}/raflar`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (!d.success) {
            setError(d.error || 'Raflar yüklenemedi');
            return;
          }
          setShelves(d.data?.shelves ?? []);
        })
        .catch((e) => {
          if (cancelled) return;
          logger.error('Raf listesi fetch', e);
          setError('Sunucuya bağlanılamadı');
        })
        .finally(() => {
          if (!cancelled) setLoadingShelves(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [isOpen, warehouseCode]);

  // İçerikli rafları filtre + arama
  const filteredShelves = useMemo(() => {
    const q = shelfQuery.trim().toLowerCase();
    return shelves.filter((s) => {
      const hasContent =
        s.summary.looseLines > 0 ||
        s.summary.sealedBoxes > 0 ||
        s.summary.partialBoxes > 0;
      if (!hasContent) return false;
      if (shelfTypeFilter !== 'ALL' && s.shelfType !== shelfTypeFilter) return false;
      if (q && !s.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [shelves, shelfQuery, shelfTypeFilter]);

  const selectShelf = (shelf: ShelfSummary) => {
    setSelectedShelf(shelf);
    setStep('pick');
    setLoadingDetail(true);
    setError(null);
    fetch(`/api/depolar/${warehouseCode}/raflar/${shelf.id}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) {
          setError(d.error || 'Raf detayı yüklenemedi');
          return;
        }
        setDetail(d.data);
      })
      .catch((e) => {
        logger.error('Raf detay fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => setLoadingDetail(false));
  };

  const back = () => {
    setStep('shelf');
    setSelectedShelf(null);
    setDetail(null);
    setError(null);
  };

  const pickStock = (s: StockRow) => {
    if (!selectedShelf) return;
    onSelect({
      type: 'stock',
      id: s.id,
      iwasku: s.iwasku,
      productName: s.productName ?? '',
      available: s.availableQty,
      fromShelfId: selectedShelf.id,
      fromShelfCode: selectedShelf.code,
    });
    onClose();
  };

  const pickBox = (b: BoxRow) => {
    if (!selectedShelf) return;
    onSelect({
      type: 'box',
      id: b.id,
      iwasku: b.iwasku,
      productName: b.productName ?? '',
      available: b.availableQty,
      fromShelfId: selectedShelf.id,
      fromShelfCode: selectedShelf.code,
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
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl h-[80vh] flex flex-col text-gray-900"
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
              Transfer —{' '}
              {step === 'shelf'
                ? 'Raf Seç'
                : `${selectedShelf?.code ?? ''} • Tekil ürün / koli seç`}
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
          {step === 'shelf' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    autoFocus
                    value={shelfQuery}
                    onChange={(e) => setShelfQuery(e.target.value)}
                    placeholder="Raf kodu ara (A1-1, B2-3 …)"
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400 text-gray-900"
                  />
                </div>
                <select
                  value={shelfTypeFilter}
                  onChange={(e) =>
                    setShelfTypeFilter(e.target.value as 'ALL' | 'POOL' | 'TEMP' | 'NORMAL')
                  }
                  className="px-2 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400 text-gray-900"
                >
                  <option value="ALL">Tüm tipler</option>
                  <option value="NORMAL">Normal</option>
                  <option value="POOL">Havuz</option>
                  <option value="TEMP">Geçici</option>
                </select>
              </div>

              {loadingShelves && (
                <div className="text-center py-6 text-gray-500 text-sm">Raflar yükleniyor…</div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-3 h-3" /> {error}
                </div>
              )}

              {!loadingShelves && !error && filteredShelves.length === 0 && (
                <div className="text-center py-6 text-gray-400 text-sm">
                  İçerikli raf bulunamadı.
                </div>
              )}

              {!loadingShelves && filteredShelves.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {filteredShelves.map((s) => {
                    const totalQty =
                      s.summary.looseQty + s.summary.sealedQty + s.summary.partialQty;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => selectShelf(s)}
                        className="text-left border border-gray-200 rounded-md p-2.5 hover:border-blue-400 hover:bg-blue-50 transition"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm font-medium">{s.code}</span>
                          <span className="text-[10px] uppercase text-gray-500">
                            {s.shelfType}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-gray-700">
                          {s.summary.looseLines > 0 && (
                            <span className="bg-gray-100 px-1.5 rounded">
                              Tekil {s.summary.looseLines} ({s.summary.looseQty})
                            </span>
                          )}
                          {s.summary.sealedBoxes > 0 && (
                            <span className="bg-gray-100 px-1.5 rounded">
                              Mühürlü {s.summary.sealedBoxes} ({s.summary.sealedQty})
                            </span>
                          )}
                          {s.summary.partialBoxes > 0 && (
                            <span className="bg-gray-100 px-1.5 rounded">
                              Açık {s.summary.partialBoxes} ({s.summary.partialQty})
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[10px] text-gray-500">Toplam {totalQty}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === 'pick' && (
            <div className="space-y-4">
              {loadingDetail && (
                <div className="text-center py-6 text-gray-500 text-sm">Detay yükleniyor…</div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-3 h-3" /> {error}
                </div>
              )}

              {!loadingDetail && detail && (
                <>
                  {detail.stocks.length === 0 && detail.boxes.length === 0 && (
                    <div className="text-center py-6 text-gray-400 text-sm">
                      Bu rafta kullanılabilir konum yok.
                    </div>
                  )}

                  {detail.stocks.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                        <Package className="w-3 h-3" /> Tekil ürünler
                      </div>
                      <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
                        {detail.stocks.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            disabled={s.availableQty <= 0}
                            onClick={() => pickStock(s)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between gap-3"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="font-mono text-xs text-gray-700">{s.iwasku}</span>
                              {s.productName && (
                                <span className="ml-2 text-gray-600 text-xs truncate">
                                  {s.productName}
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-gray-700 whitespace-nowrap">
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

                  {detail.boxes.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                        <BoxIcon className="w-3 h-3" /> Koliler
                      </div>
                      <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
                        {detail.boxes.map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            disabled={b.availableQty <= 0}
                            onClick={() => pickBox(b)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between gap-3"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="font-mono text-xs text-gray-700">
                                {b.boxNumber}
                              </span>
                              <span className="ml-2 font-mono text-xs text-gray-500">
                                {b.iwasku}
                              </span>
                              {b.productName && (
                                <span className="ml-2 text-gray-600 text-xs truncate">
                                  {b.productName}
                                </span>
                              )}
                              <span className="ml-2 text-[10px] uppercase text-gray-500">
                                {b.status}
                              </span>
                            </span>
                            <span className="text-xs text-gray-700 whitespace-nowrap">
                              {b.availableQty}
                            </span>
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
