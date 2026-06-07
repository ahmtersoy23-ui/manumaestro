/**
 * Çıkış Yap modal — SINGLE sipariş için raf seçimi + sevk.
 * Açılırken /ship-suggestions çağırır → her item için kandidatlar + FIFO öneri.
 * Kullanıcı her item için 1+ pick satırı belirler (raf+adet).
 * Submit → /ship-allocate → ShelfStock/ShelfBox decrement + Allocation rows.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, Plus, Trash2, Sparkles, Truck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ShipModal');

interface Candidate {
  source: 'STOCK' | 'BOX';
  locationId: string;
  shelfId: string;
  shelfCode: string;
  shelfType: string;
  availableQty: number;
  ageReference: string;
  boxNumber?: string;
  fnsku?: string | null;
  marketplaceCode?: string | null;
  status?: string;
}

interface Suggestion {
  order: number;
  source: 'STOCK' | 'BOX';
  locationId: string;
  shelfCode: string;
  suggestedQty: number;
  ageDays: number;
  rationale: string;
  boxNumber?: string;
}

interface ItemPlan {
  itemId: string;
  iwasku: string;
  productName: string | null;
  requestedQty: number;
  candidates: Candidate[];
  suggestions: Suggestion[];
  remaining: number;
}

interface PickRow {
  rowId: string;       // local
  locationId: string;  // boş = seçilmedi
  qty: number | '';
}

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  orderId: string;
  orderNumber: string;
  onClose: () => void;
  onSuccess: () => void;
}

const newRow = (): PickRow => ({
  rowId: Math.random().toString(36).slice(2),
  locationId: '',
  qty: '',
});

export function ShipModal({
  isOpen,
  warehouseCode,
  orderId,
  orderNumber,
  onClose,
  onSuccess,
}: Props) {
  const [plans, setPlans] = useState<ItemPlan[]>([]);
  const [picksByItem, setPicksByItem] = useState<Record<string, PickRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FIFO önerisini bir item için pickRow listesine çevir
  const buildRowsFromSuggestions = (item: ItemPlan): PickRow[] => {
    if (item.suggestions.length === 0) {
      return [newRow()];
    }
    return item.suggestions.map((s) => ({
      rowId: Math.random().toString(36).slice(2),
      locationId: s.locationId,
      qty: s.suggestedQty,
    }));
  };

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setLoading(true);
    fetch(`/api/depolar/${warehouseCode}/siparis/${orderId}/ship-suggestions`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) {
          setError(d.error || 'Öneriler alınamadı');
          return;
        }
        const items: ItemPlan[] = d.data.items;
        setPlans(items);
        const initial: Record<string, PickRow[]> = {};
        for (const it of items) initial[it.itemId] = buildRowsFromSuggestions(it);
        setPicksByItem(initial);
      })
      .catch((e) => {
        logger.error('Suggestions fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => setLoading(false));
  }, [isOpen, warehouseCode, orderId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, submitting]);

  const updateRow = (itemId: string, rowId: string, patch: Partial<PickRow>) => {
    setPicksByItem((prev) => ({
      ...prev,
      [itemId]: prev[itemId].map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
    }));
  };
  const removeRow = (itemId: string, rowId: string) => {
    setPicksByItem((prev) => ({
      ...prev,
      [itemId]: prev[itemId].length === 1 ? prev[itemId] : prev[itemId].filter((r) => r.rowId !== rowId),
    }));
  };
  const addRow = (itemId: string) => {
    setPicksByItem((prev) => ({
      ...prev,
      [itemId]: [...(prev[itemId] ?? []), newRow()],
    }));
  };
  const applyFifo = (item: ItemPlan) => {
    setPicksByItem((prev) => ({ ...prev, [item.itemId]: buildRowsFromSuggestions(item) }));
  };

  // Her item için durum (uyumlu mu)
  const itemStates = useMemo(() => {
    return plans.map((it) => {
      const rows = picksByItem[it.itemId] ?? [];
      const usedByLocation = new Map<string, number>();
      let totalQty = 0;
      let hasIncomplete = false;
      for (const r of rows) {
        const q = typeof r.qty === 'number' ? r.qty : 0;
        if (!r.locationId || q <= 0) {
          if (r.locationId || q) hasIncomplete = true;
          continue;
        }
        usedByLocation.set(r.locationId, (usedByLocation.get(r.locationId) ?? 0) + q);
        totalQty += q;
      }
      const overflows: { locationId: string; used: number; available: number }[] = [];
      for (const c of it.candidates) {
        const used = usedByLocation.get(c.locationId);
        if (used !== undefined && used > c.availableQty) {
          overflows.push({ locationId: c.locationId, used, available: c.availableQty });
        }
      }
      const matches = totalQty === it.requestedQty;
      return { itemId: it.itemId, totalQty, matches, hasIncomplete, overflows };
    });
  }, [plans, picksByItem]);

  const allOk = plans.length > 0 && itemStates.every((s) => s.matches && !s.hasIncomplete && s.overflows.length === 0);

  const handleSubmit = async () => {
    setError(null);
    if (!allOk) {
      setError('Tüm ürünleri tam adetle eşle.');
      return;
    }

    const allocations = plans.map((it) => {
      const rows = picksByItem[it.itemId];
      const candById = new Map(it.candidates.map((c) => [c.locationId, c]));
      return {
        itemId: it.itemId,
        picks: rows
          .filter((r) => r.locationId && typeof r.qty === 'number' && r.qty > 0)
          .map((r) => {
            const c = candById.get(r.locationId)!;
            return c.source === 'STOCK'
              ? {
                  source: 'STOCK' as const,
                  shelfStockId: c.locationId,
                  shelfId: c.shelfId,
                  qty: r.qty as number,
                }
              : {
                  source: 'BOX' as const,
                  shelfBoxId: c.locationId,
                  qty: r.qty as number,
                };
          }),
      };
    });

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/depolar/${warehouseCode}/siparis/${orderId}/ship-allocate`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allocations }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Çıkış yapılamadı');
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Ship submit', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ship-modal-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col text-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div>
            <h2 id="ship-modal-title" className="text-lg font-semibold">
              Çıkış Yap — {orderNumber}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Her ürün için raf seç. FIFO önerisi pre-fill geldi, override edebilirsin.
            </p>
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

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && <div className="text-center py-8 text-gray-500 text-sm">Öneriler yükleniyor…</div>}

          {!loading && plans.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">Sipariş ürünü yok.</div>
          )}

          {!loading &&
            plans.map((it) => {
              const state = itemStates.find((s) => s.itemId === it.itemId);
              const rows = picksByItem[it.itemId] ?? [];
              const stockShortage = it.remaining > 0;
              return (
                <ItemPlanBlock
                  key={it.itemId}
                  item={it}
                  rows={rows}
                  state={state}
                  stockShortage={stockShortage}
                  onAddRow={() => addRow(it.itemId)}
                  onRemoveRow={(rowId) => removeRow(it.itemId, rowId)}
                  onUpdateRow={(rowId, patch) => updateRow(it.itemId, rowId, patch)}
                  onApplyFifo={() => applyFifo(it)}
                />
              );
            })}
        </div>

        {error && (
          <div className="mx-5 mb-3 bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-3 h-3" /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            İptal
          </Button>
          <Button
            type="button"
            variant="success"
            size="sm"
            onClick={handleSubmit}
            loading={submitting}
            disabled={submitting || !allOk}
            icon={!submitting ? <Truck className="w-4 h-4" /> : undefined}
          >
            {submitting ? 'Çıkış yapılıyor…' : 'Çıkış Yap'}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface BlockProps {
  item: ItemPlan;
  rows: PickRow[];
  state?: { totalQty: number; matches: boolean; hasIncomplete: boolean; overflows: { locationId: string; used: number; available: number }[] };
  stockShortage: boolean;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
  onUpdateRow: (rowId: string, patch: Partial<PickRow>) => void;
  onApplyFifo: () => void;
}

function ItemPlanBlock({
  item,
  rows,
  state,
  stockShortage,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onApplyFifo,
}: BlockProps) {
  const totalQty = state?.totalQty ?? 0;
  const matches = state?.matches ?? false;
  const overflows = state?.overflows ?? [];

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-medium text-gray-900">
            {item.iwasku}
            {item.productName && (
              <span className="ml-2 font-normal text-gray-600">— {item.productName}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            İhtiyaç: <span className="font-semibold">{item.requestedQty}</span>
            {' • '}
            Seçilen: <span className={matches ? 'text-green-700 font-semibold' : 'text-amber-700 font-semibold'}>{totalQty}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onApplyFifo}
          disabled={item.suggestions.length === 0}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-purple-700 bg-purple-50 hover:bg-purple-100 rounded disabled:opacity-40"
          title="FIFO önerisini uygula"
        >
          <Sparkles className="w-3 h-3" /> FIFO Öner
        </button>
      </div>

      {stockShortage && (
        <div className="mb-2 bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-3 h-3" /> Stok yetersiz — bu ürün için
          {' '}{item.requestedQty - rows.reduce((s, r) => s + (typeof r.qty === 'number' ? r.qty : 0), 0)}
          {' '}adet eksik.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((row) => {
          const cand = item.candidates.find((c) => c.locationId === row.locationId);
          const overflow = overflows.find((o) => o.locationId === row.locationId);
          return (
            <div key={row.rowId} className="flex gap-2 items-start">
              <select
                value={row.locationId}
                onChange={(e) => onUpdateRow(row.rowId, { locationId: e.target.value })}
                className="flex-1 px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
              >
                <option value="">Raf seç…</option>
                {item.candidates.map((c) => (
                  <option key={c.locationId} value={c.locationId}>
                    {c.shelfCode} ({c.shelfType})
                    {c.source === 'BOX' ? ` • koli ${c.boxNumber}` : ' • tekil'}
                    {' • '}
                    {c.availableQty} adet
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                max={cand?.availableQty ?? 100000}
                value={row.qty}
                onChange={(e) =>
                  onUpdateRow(row.rowId, {
                    qty: e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
                placeholder="Adet"
                className={`w-24 px-2 py-1.5 border rounded-md text-sm focus:outline-none ${
                  overflow ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-blue-400'
                }`}
              />
              <button
                type="button"
                onClick={() => onRemoveRow(row.rowId)}
                disabled={rows.length === 1}
                title={rows.length > 1 ? 'Satırı sil' : ''}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onAddRow}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
        >
          <Plus className="w-3 h-3" /> Satır Ekle
        </button>
        {overflows.length > 0 && (
          <span className="text-[11px] text-red-700">
            Bir veya daha fazla raf: seçim mevcut adedi aşıyor.
          </span>
        )}
        {!matches && overflows.length === 0 && totalQty !== 0 && (
          <span className="text-[11px] text-amber-700">
            Toplam {item.requestedQty} olmalı, şu an {totalQty}.
          </span>
        )}
      </div>
    </div>
  );
}
