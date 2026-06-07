/**
 * Rafı Boşalt — admin only.
 * Hedef raf seçici (combobox + arama, POOL üstte) + onay.
 * Backend: POST /api/depolar/[code]/raflar/[shelfId]/empty
 *
 * Cross-warehouse hedef desteklenir (NJ ↔ SHOWROOM POOL/TEMP).
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, AlertCircle, Search, ChevronDown, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { createLogger } from '@/lib/logger';
import { warehouseLabel } from '@/lib/warehouseLabels';

const logger = createLogger('EmptyShelfDialog');

const CROSS_TARGETS: Record<string, string> = {
  NJ: 'SHOWROOM',
  SHOWROOM: 'NJ',
};

interface ShelfOption {
  id: string;
  code: string;
  shelfType: 'POOL' | 'TEMP' | 'NORMAL';
  warehouseCode?: string;
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  shelf: { id: string; code: string; shelfType: string } | null;
  stockCount: number;
  boxCount: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function EmptyShelfDialog({
  isOpen,
  warehouseCode,
  shelf,
  stockCount,
  boxCount,
  onClose,
  onSuccess,
}: Props) {
  const [shelves, setShelves] = useState<ShelfOption[]>([]);
  const [crossShelves, setCrossShelves] = useState<ShelfOption[]>([]);
  const [toShelfId, setToShelfId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comboboxRef = useRef<HTMLDivElement>(null);

  const crossTargetWh = CROSS_TARGETS[warehouseCode];

  useEffect(() => {
    if (!isOpen || !shelf) return;
    let cancelled = false;
    fetch(`/api/depolar/${warehouseCode}/raflar`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          setShelves(
            (d.data.shelves || [])
              .filter((s: ShelfOption) => s.id !== shelf.id)
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
            setCrossShelves(
              (d.data.shelves || [])
                .filter((s: ShelfOption) => s.shelfType === 'POOL' || s.shelfType === 'TEMP')
                .map((s: ShelfOption) => ({ ...s, warehouseCode: crossTargetWh }))
            );
          }
        })
        .catch((e) => logger.error('Cross shelves fetch', e));
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, warehouseCode, crossTargetWh, shelf]);

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setToShelfId('');
        setSearchTerm('');
        setDropdownOpen(false);
        setError(null);
      }, 0);
      return () => clearTimeout(t);
    }
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
    if (!dropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [dropdownOpen]);

  const allTargets = useMemo(() => [...shelves, ...crossShelves], [shelves, crossShelves]);
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return allTargets;
    return allTargets.filter((s) => s.code.toLowerCase().includes(q));
  }, [allTargets, searchTerm]);
  const grouped = useMemo(
    () => ({
      POOL: filtered.filter((s) => s.shelfType === 'POOL'),
      TEMP: filtered.filter((s) => s.shelfType === 'TEMP'),
      NORMAL: filtered.filter((s) => s.shelfType === 'NORMAL'),
    }),
    [filtered]
  );
  const selected = allTargets.find((s) => s.id === toShelfId);

  if (!isOpen || !shelf) return null;

  const handleSubmit = async () => {
    if (!toShelfId) {
      setError('Hedef raf seçin');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/depolar/${warehouseCode}/raflar/${shelf.id}/empty`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetShelfId: toShelfId }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Boşaltma başarısız');
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Empty submit', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 text-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-amber-800">
            <AlertTriangle className="w-5 h-5" /> Rafı Boşalt
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Kapat"
            className="p-1 hover:bg-gray-100 rounded disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 space-y-1 mb-3">
          <p>
            <span className="font-mono font-semibold">{shelf.code}</span> rafının tüm
            içeriği seçtiğin hedefe taşınacak:
          </p>
          <p>
            <b>{stockCount}</b> tekil ürün satırı, <b>{boxCount}</b> koli (rezerveli stok
            varsa işlem reddedilir).
          </p>
          <p>Her satır için ShelfMovement audit kaydı oluşur.</p>
        </div>

        <div ref={comboboxRef} className="relative mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Hedef raf</label>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 border border-gray-200 rounded-md text-sm bg-white hover:border-blue-300 focus:outline-none focus:border-blue-400"
          >
            {selected ? (
              <span className="font-mono text-sm">
                {selected.code}
                <span className="ml-2 text-[10px] uppercase text-gray-500">
                  {selected.shelfType}
                </span>
                {selected.warehouseCode &&
                  selected.warehouseCode !== warehouseCode && (
                    <span className="ml-2 text-[10px] uppercase text-purple-700">
                      {warehouseLabel(selected.warehouseCode)}
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
                {filtered.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-gray-400 text-center">
                    Eşleşen raf yok.
                  </div>
                ) : (
                  <>
                    {(['POOL', 'TEMP', 'NORMAL'] as const).map((kind) => {
                      const list = grouped[kind];
                      if (list.length === 0) return null;
                      const title =
                        kind === 'POOL' ? 'Havuz' : kind === 'TEMP' ? 'Geçici' : 'Normal';
                      return (
                        <div key={kind}>
                          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-700 bg-gray-100 sticky top-0 font-semibold">
                            {title}
                          </div>
                          {list.map((s) => {
                            const cross = s.warehouseCode && s.warehouseCode !== warehouseCode;
                            const isSel = toShelfId === s.id;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  setToShelfId(s.id);
                                  setDropdownOpen(false);
                                  setSearchTerm('');
                                }}
                                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-blue-50 border-b border-gray-50 last:border-b-0 ${
                                  isSel ? 'bg-blue-50 font-semibold text-blue-900' : 'text-gray-900'
                                }`}
                              >
                                <span className="font-mono">{s.code}</span>
                                {cross && (
                                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                                    {warehouseLabel(s.warehouseCode!)}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2 mb-3">
            <AlertCircle className="w-3 h-3" /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            İptal
          </Button>
          <Button type="button" variant="warning" size="sm" onClick={handleSubmit} loading={submitting} disabled={submitting || !toShelfId}>
            {submitting ? 'Boşaltılıyor…' : 'Rafı Boşalt'}
          </Button>
        </div>
      </div>
    </div>
  );
}
