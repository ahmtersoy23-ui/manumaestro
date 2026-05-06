/**
 * Transfer Modal — raflar arası tekil ürün veya koli transferi.
 * Aynı depo: herhangi bir raf hedef.
 * Cross-warehouse (NJ ↔ Showroom): yalnız POOL/TEMP rafları hedef.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowRight, AlertCircle, Search, ChevronDown } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('TransferDialog');

interface ShelfOption {
  id: string;
  code: string;
  shelfType: 'POOL' | 'TEMP' | 'NORMAL';
  warehouseCode?: string; // cross-warehouse opsiyonları için işaret
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
  const [toShelfId, setToShelfId] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Combobox: arama + dropdown
  const [searchTerm, setSearchTerm] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);

  const crossTargetWh = CROSS_TARGETS[warehouseCode];

  // Modal açılınca raf listelerini yükle
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch(`/api/depolar/${warehouseCode}/raflar`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          setShelves(
            (d.data.shelves || [])
              .filter((s: ShelfOption) => s.id !== source?.fromShelfId)
              .map((s: ShelfOption) => ({ ...s, warehouseCode }))
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
            // Sadece POOL ve TEMP cross-warehouse hedef olabilir
            setCrossShelves(
              (d.data.shelves || [])
                .filter((s: ShelfOption) => s.shelfType === 'POOL' || s.shelfType === 'TEMP')
                .map((s: ShelfOption) => ({ ...s, warehouseCode: crossTargetWh }))
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
    setSearchTerm('');
    setDropdownOpen(false);
    setError(null);
  }, [isOpen, source]);

  // Click outside dropdown'u kapatır
  useEffect(() => {
    if (!dropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [dropdownOpen]);

  // Tüm hedef raflar tek listede; POOL en üstte gruplu, sonra TEMP, sonra NORMAL
  const allTargets = useMemo(() => [...shelves, ...crossShelves], [shelves, crossShelves]);
  const filteredTargets = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return allTargets;
    return allTargets.filter((s) => s.code.toLowerCase().includes(q));
  }, [allTargets, searchTerm]);
  const grouped = useMemo(
    () => ({
      POOL: filteredTargets.filter((s) => s.shelfType === 'POOL'),
      TEMP: filteredTargets.filter((s) => s.shelfType === 'TEMP'),
      NORMAL: filteredTargets.filter((s) => s.shelfType === 'NORMAL'),
    }),
    [filteredTargets]
  );
  const selectedTarget = allTargets.find((s) => s.id === toShelfId);

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
          {/* Hedef raf — combobox (arama + grup) */}
          <div ref={comboboxRef} className="relative">
            <label className="block text-xs font-medium text-gray-700 mb-1">Hedef raf</label>
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              aria-expanded={dropdownOpen}
              className="w-full flex items-center justify-between px-3 py-2 border border-gray-200 rounded-md text-sm bg-white hover:border-blue-300 focus:outline-none focus:border-blue-400"
            >
              {selectedTarget ? (
                <span className="font-mono text-sm text-gray-900">
                  {selectedTarget.code}
                  <span className="ml-2 text-[10px] uppercase text-gray-500">
                    {selectedTarget.shelfType}
                  </span>
                  {selectedTarget.warehouseCode &&
                    selectedTarget.warehouseCode !== warehouseCode && (
                      <span className="ml-2 text-[10px] uppercase text-purple-700">
                        {selectedTarget.warehouseCode}
                      </span>
                    )}
                </span>
              ) : (
                <span className="text-gray-400">Raf seç…</span>
              )}
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>

            {dropdownOpen && (
              <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-72 overflow-hidden flex flex-col">
                <div className="p-2 border-b border-gray-100 sticky top-0 bg-white">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input
                      autoFocus
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Raf kodu ara…"
                      className="w-full pl-8 pr-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>
                <div className="overflow-y-auto">
                  {filteredTargets.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-gray-400 text-center">
                      Eşleşen raf yok.
                    </div>
                  ) : (
                    <>
                      {grouped.POOL.length > 0 && (
                        <Group
                          title="Havuz Rafları"
                          options={grouped.POOL}
                          warehouseCode={warehouseCode}
                          onSelect={(id) => {
                            setToShelfId(id);
                            setDropdownOpen(false);
                            setSearchTerm('');
                          }}
                          selectedId={toShelfId}
                        />
                      )}
                      {grouped.TEMP.length > 0 && (
                        <Group
                          title="Geçici"
                          options={grouped.TEMP}
                          warehouseCode={warehouseCode}
                          onSelect={(id) => {
                            setToShelfId(id);
                            setDropdownOpen(false);
                            setSearchTerm('');
                          }}
                          selectedId={toShelfId}
                        />
                      )}
                      {grouped.NORMAL.length > 0 && (
                        <Group
                          title="Normal"
                          options={grouped.NORMAL}
                          warehouseCode={warehouseCode}
                          onSelect={(id) => {
                            setToShelfId(id);
                            setDropdownOpen(false);
                            setSearchTerm('');
                          }}
                          selectedId={toShelfId}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
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
              {selectedTarget?.code ?? '?'}
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

interface GroupProps {
  title: string;
  options: ShelfOption[];
  warehouseCode: string;
  onSelect: (id: string) => void;
  selectedId: string;
}

function Group({ title, options, warehouseCode, onSelect, selectedId }: GroupProps) {
  return (
    <div>
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 bg-gray-50 sticky top-0">
        {title}
      </div>
      {options.map((s) => {
        const cross = s.warehouseCode && s.warehouseCode !== warehouseCode;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-blue-50 ${
              selectedId === s.id ? 'bg-blue-50 font-semibold' : ''
            }`}
          >
            <span className="font-mono">{s.code}</span>
            {cross && (
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                {s.warehouseCode}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
