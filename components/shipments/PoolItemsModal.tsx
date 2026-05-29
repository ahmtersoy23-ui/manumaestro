/**
 * PoolItemsModal — Sevkiyat detay sayfasında "Havuzdan Ekle" akışı.
 *
 * Sevkiyatın bağlı olduğu ülke için (US/UK/EU/CA/AU/ZA) sevkiyat bekleyen
 * COMPLETED PR'ları gösterir — destinasyon bazlı gruplandı (US FBA / NJ Depo /
 * CG Depo). Operatör checkbox ile seçim yapar, "Sevkiyata Ekle" → bulk POST.
 *
 * Otomatik field eşleştirme: item.recommendedDestination + productionRequestId
 * + marketplaceId PR'dan taşınır.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Package, Search, CheckSquare, Square } from 'lucide-react';
import { notify } from '@/lib/ui/notify';
import {
  SHIPMENT_DESTINATION_LABELS,
  SHIPMENT_DESTINATION_STYLES,
} from '@/lib/marketplaceRegions';

interface PoolItem {
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  productSize: number | null;
  quantity: number;
  producedQuantity: number | null;
  marketplaceCode: string;
  marketplaceName: string;
  recommendedDestination: string;
  productionMonth: string;
}

interface Props {
  shipmentId: string;
  shipmentName: string;
  country: string; // US / UK / EU / ...
  marketplaceIdByCode: Map<string, string>; // PR.marketplaceCode → marketplace.id (eklerken gerek)
  onClose: () => void;
  onSuccess: () => void;
}

export function PoolItemsModal({ shipmentId, shipmentName, country, marketplaceIdByCode, onClose, onSuccess }: Props) {
  const [items, setItems] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch(`/api/shipments/pools/items?country=${country}`)
      .then(r => r.json())
      .then(d => { if (d.success) setItems(d.data.items ?? []); })
      .catch(() => notify.error('Havuz yüklenemedi'))
      .finally(() => setLoading(false));
  }, [country]);

  // Filtered + grouped
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items.filter(it =>
      it.iwasku.toLowerCase().includes(query) ||
      it.productName.toLowerCase().includes(query) ||
      it.productCategory.toLowerCase().includes(query),
    );
  }, [items, q]);

  const grouped = useMemo(() => {
    const m = new Map<string, PoolItem[]>();
    for (const it of filtered) {
      const k = it.recommendedDestination;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const toggleOne = (id: string) => {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (group: PoolItem[]) => {
    const ids = group.map(it => it.id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(s => {
      const next = new Set(s);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  const totalSelected = selected.size;
  const totalSelectedQty = items
    .filter(it => selected.has(it.id))
    .reduce((sum, it) => sum + it.quantity, 0);

  const handleAdd = async () => {
    if (totalSelected === 0) return;
    setAdding(true);
    try {
      const toSend = items
        .filter(it => selected.has(it.id))
        .map(it => ({
          iwasku: it.iwasku,
          quantity: it.quantity,
          marketplaceId: marketplaceIdByCode.get(it.marketplaceCode),
          productionRequestId: it.id,
          recommendedDestination: it.recommendedDestination,
        }));

      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toSend }),
      });
      const data = await res.json();
      if (data.success) {
        notify.success(`${data.data.added} ürün sevkiyata eklendi`);
        onSuccess();
      } else {
        notify.error(data.error ?? 'Ekleme başarısız');
      }
    } catch {
      notify.error('Bağlantı hatası');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-slate-600" />
            <div>
              <h3 className="font-semibold text-slate-900">Havuzdan Ekle — {shipmentName}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{country} ülkesindeki sevkiyat bekleyen ürünler</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-100 flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="iwasku, ürün adı veya kategori..."
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <span className="text-xs text-slate-500 whitespace-nowrap">
            {filtered.length} ürün / {totalSelected} seçili
          </span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">
              {q ? 'Arama kriterine uyan ürün yok' : 'Bu ülke için bekleyen ürün yok'}
            </div>
          )}
          {!loading && grouped.map(([dest, group]) => {
            const style = SHIPMENT_DESTINATION_STYLES[dest]
              ?? { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' };
            const label = SHIPMENT_DESTINATION_LABELS[dest] ?? dest;
            const allSelected = group.every(it => selected.has(it.id));
            const someSelected = !allSelected && group.some(it => selected.has(it.id));
            return (
              <div key={dest} className={`rounded-lg border ${style.border}`}>
                <button onClick={() => toggleGroup(group)}
                  className={`w-full flex items-center justify-between px-3 py-2 ${style.bg} ${style.text} rounded-t-lg`}>
                  <div className="flex items-center gap-2">
                    {allSelected ? <CheckSquare className="w-4 h-4" /> : someSelected ? <CheckSquare className="w-4 h-4 opacity-50" /> : <Square className="w-4 h-4" />}
                    <span className="text-sm font-semibold">{label}</span>
                    <span className="text-xs opacity-70">({group.length} ürün)</span>
                  </div>
                  <span className="text-xs opacity-70">
                    {group.reduce((s, it) => s + it.quantity, 0).toLocaleString('tr-TR')} adet
                  </span>
                </button>
                <div className="divide-y divide-slate-100">
                  {group.map(it => (
                    <label key={it.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs">
                      <input type="checkbox" checked={selected.has(it.id)}
                        onChange={() => toggleOne(it.id)}
                        className="w-4 h-4" />
                      <span className="font-mono text-cyan-700 w-28 truncate">{it.iwasku}</span>
                      <span className="flex-1 truncate text-slate-900">{it.productName}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">
                        {it.marketplaceName}
                      </span>
                      <span className="w-16 text-right font-bold text-purple-700 tabular-nums">{it.quantity}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-slate-50 rounded-b-xl">
          <div className="text-sm text-slate-600">
            {totalSelected > 0 ? (
              <>Toplam <span className="font-semibold text-slate-900">{totalSelected}</span> ürün / <span className="font-semibold text-slate-900">{totalSelectedQty.toLocaleString('tr-TR')}</span> adet</>
            ) : (
              'Eklemek istediğiniz ürünleri seçin'
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 text-sm bg-white border border-slate-300 rounded-lg hover:bg-slate-50">
              İptal
            </button>
            <button onClick={handleAdd} disabled={totalSelected === 0 || adding}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {adding && <Loader2 className="w-4 h-4 animate-spin" />}
              Sevkiyata Ekle ({totalSelected})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
