/**
 * Sil (admin) — tekil ürün veya koli silme.
 * 3 adım:
 *   1. iwasku/ürün ara
 *   2. Konum listele (ShelfStock + ShelfBox)
 *   3. Birini seç → reason ile onay → backend silmeye çağır
 *
 * Audit: ShelfMovement(ADJUSTMENT, refType=DELETE) sunucuda yaratılır.
 * Reservedy>0 olan kayıtlar pasif gelir (uyarı tooltip).
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Search,
  X,
  AlertCircle,
  ArrowLeft,
  Box as BoxIcon,
  Package,
  Trash2,
} from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DeleteStockDialog');

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

type Target =
  | { kind: 'STOCK'; loc: StockLoc; iwasku: string; productName: string | null }
  | { kind: 'BOX'; loc: BoxLoc; iwasku: string; productName: string | null };

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteStockDialog({ isOpen, warehouseCode, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<'search' | 'pick' | 'confirm'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductHit | null>(null);
  const [konumlar, setKonumlar] = useState<KonumlarResponse | null>(null);
  const [loadingKonum, setLoadingKonum] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setStep('search');
        setSearchQuery('');
        setHits([]);
        setSelectedProduct(null);
        setKonumlar(null);
        setTarget(null);
        setReason('');
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
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, submitting]);

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
    if (step === 'confirm') {
      setStep('pick');
      setTarget(null);
      setReason('');
      setError(null);
    } else if (step === 'pick') {
      setStep('search');
      setSelectedProduct(null);
      setKonumlar(null);
    }
  };

  const handleConfirm = async () => {
    if (!target) return;
    setError(null);
    if (reason.trim().length < 3) {
      setError('Sebep girin (en az 3 karakter).');
      return;
    }
    setSubmitting(true);
    try {
      const body =
        target.kind === 'STOCK'
          ? { type: 'STOCK', shelfStockId: target.loc.id, reason: reason.trim() }
          : { type: 'BOX', shelfBoxId: target.loc.id, reason: reason.trim() };
      const res = await fetch(`/api/depolar/${warehouseCode}/sil`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Silinemedi');
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Delete submit', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const titleByStep =
    step === 'search'
      ? 'Sil — Ürün Seç'
      : step === 'pick'
      ? 'Sil — Konum Seç'
      : 'Sil — Onayla';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            {step !== 'search' && (
              <button
                type="button"
                onClick={back}
                disabled={submitting}
                aria-label="Geri"
                className="p-1 hover:bg-gray-100 rounded disabled:opacity-50"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-red-700 flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> {titleByStep}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Kapat"
            className="p-1 hover:bg-gray-100 rounded disabled:opacity-50"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {step === 'search' && (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
                Bu aksiyon kalıcıdır. ShelfMovement audit log&apos;una &ldquo;DELETE&rdquo; ref&apos;iyle yazılır,
                rezerve olan kayıtlar silinemez.
              </div>
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
                  placeholder="iwasku veya ürün adı (en az 2 karakter)"
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
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 'pick' && (
            <>
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
                      Bu depoda kayıt yok.
                    </div>
                  )}
                  {konumlar.stocks.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                        <Package className="w-3 h-3" /> Tekil
                      </div>
                      <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
                        {konumlar.stocks.map((s) => {
                          const blocked = s.reservedQty > 0;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              disabled={blocked}
                              onClick={() => {
                                setTarget({
                                  kind: 'STOCK',
                                  loc: s,
                                  iwasku: konumlar.iwasku,
                                  productName: konumlar.productName,
                                });
                                setStep('confirm');
                              }}
                              title={
                                blocked
                                  ? `Rezerve ${s.reservedQty} adet — önce sipariş iptal/sevk edilmeli`
                                  : 'Sil'
                              }
                              className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between"
                            >
                              <span>
                                <span className="font-mono text-xs text-gray-700">
                                  {s.shelfCode}
                                </span>
                                <span className="ml-2 text-[10px] uppercase text-gray-500">
                                  {s.shelfType}
                                </span>
                              </span>
                              <span className="text-xs text-gray-700">
                                {s.quantity}
                                {s.reservedQty > 0 && (
                                  <span className="ml-1 text-amber-600">
                                    (rezerve {s.reservedQty})
                                  </span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {konumlar.boxes.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                        <BoxIcon className="w-3 h-3" /> Koliler
                      </div>
                      <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
                        {konumlar.boxes.map((b) => {
                          const blocked = b.reservedQty > 0;
                          return (
                            <button
                              key={b.id}
                              type="button"
                              disabled={blocked}
                              onClick={() => {
                                setTarget({
                                  kind: 'BOX',
                                  loc: b,
                                  iwasku: konumlar.iwasku,
                                  productName: konumlar.productName,
                                });
                                setStep('confirm');
                              }}
                              title={
                                blocked
                                  ? `Rezerve ${b.reservedQty} adet — önce sipariş iptal/sevk edilmeli`
                                  : 'Sil'
                              }
                              className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between"
                            >
                              <span>
                                <span className="font-mono text-xs text-gray-700">
                                  {b.boxNumber}
                                </span>
                                <span className="ml-2 text-gray-500 text-xs">@ {b.shelfCode}</span>
                                <span className="ml-2 text-[10px] uppercase text-gray-500">
                                  {b.status}
                                </span>
                              </span>
                              <span className="text-xs text-gray-700">{b.quantity}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === 'confirm' && target && (
            <>
              <div className="bg-red-50 border border-red-200 rounded p-3 space-y-2">
                <div className="text-sm font-semibold text-red-900 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Silinecek kayıt
                </div>
                <div className="text-sm text-gray-800">
                  <span className="font-mono text-xs">{target.iwasku}</span>
                  {target.productName && (
                    <span className="ml-2 text-gray-600">— {target.productName}</span>
                  )}
                </div>
                <div className="text-xs text-gray-700">
                  {target.kind === 'STOCK'
                    ? `Tekil • ${target.loc.shelfCode} (${target.loc.shelfType}) • ${target.loc.quantity} adet`
                    : `Koli ${target.loc.boxNumber} @ ${target.loc.shelfCode} • ${target.loc.quantity} adet`}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Sebep (audit) *
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Hatalı giriş, fire, hasar…"
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-3 h-3" /> {error}
                </div>
              )}
            </>
          )}
        </div>

        {step === 'confirm' && (
          <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
            <button
              type="button"
              onClick={back}
              disabled={submitting}
              className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-50"
            >
              Geri
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || reason.trim().length < 3}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              {submitting ? 'Siliniyor…' : 'Kalıcı Olarak Sil'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
