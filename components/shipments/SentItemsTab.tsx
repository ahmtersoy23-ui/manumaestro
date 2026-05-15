/**
 * SentItemsTab — gönderilen ürünler tabı (search/filter + actions + table).
 *
 * "Depo Çıkışı Kaydet" + "Gönderimi Geri Al" sadece selectedSentIds > 0 iken.
 * Permissions parent'tan gelir.
 */

import { Search, X, Package, Loader2, CheckSquare, Square, Ship } from 'lucide-react';
import type { ShipmentItem } from '@/lib/shipments/types';
import { DateMultiFilter } from './DateMultiFilter';

interface Props {
  items: ShipmentItem[];       // filteredSentItems
  hasAnySent: boolean;         // sentItems.length > 0
  totalSentCount: number;      // sentItems.length (Tümünü seç için)

  search: string;
  categoryFilter: string;
  marketFilter: string;
  dateFilter: Set<string>;
  categories: string[];
  markets: string[];
  dates: string[];

  selectedSentIds: Set<string>;
  canSend: boolean;
  canUnsend: boolean;
  unsending: boolean;

  onSearchChange: (search: string) => void;
  onCategoryFilterChange: (filter: string) => void;
  onMarketFilterChange: (filter: string) => void;
  onDateFilterChange: (filter: Set<string>) => void;
  onSelectionChange: (next: Set<string>) => void;
  onExitForSent: () => void;
  onUnsendSelected: () => void;
}

export function SentItemsTab({
  items, hasAnySent, totalSentCount,
  search, categoryFilter, marketFilter, dateFilter, categories, markets, dates,
  selectedSentIds, canSend, canUnsend, unsending,
  onSearchChange, onCategoryFilterChange, onMarketFilterChange, onDateFilterChange,
  onSelectionChange, onExitForSent, onUnsendSelected,
}: Props) {
  const toggleItem = (id: string) => {
    const next = new Set(selectedSentIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  };

  const toggleAll = () => {
    if (selectedSentIds.size === totalSentCount) onSelectionChange(new Set());
    else onSelectionChange(new Set(items.map(i => i.id)));
  };

  const allSelected = selectedSentIds.size === totalSentCount && totalSentCount > 0;
  const hasSelectionActions = canSend || canUnsend;

  return (
    <div className="space-y-4">
      {hasAnySent && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" value={search} onChange={e => onSearchChange(e.target.value)}
              placeholder="SKU, ürün adı..."
              className="pl-9 pr-3 py-2 border rounded-lg text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            {search && (
              <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {categories.length > 1 && (
            <select value={categoryFilter} onChange={e => onCategoryFilterChange(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
              <option value="">Tüm Kategoriler</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {markets.length > 1 && (
            <select value={marketFilter} onChange={e => onMarketFilterChange(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm text-gray-700 bg-white">
              <option value="">Tüm Pazarlar</option>
              {markets.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <DateMultiFilter dates={dates} selected={dateFilter} onChange={onDateFilterChange} />
          {canSend && selectedSentIds.size > 0 && (
            <button onClick={onExitForSent}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
              <Package className="w-4 h-4" />
              {selectedSentIds.size} ürün — Depo Çıkışı Kaydet
            </button>
          )}
          {canUnsend && selectedSentIds.size > 0 && (
            <button onClick={onUnsendSelected} disabled={unsending}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50">
              {unsending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              {selectedSentIds.size} ürün — Gönderimi Geri Al
            </button>
          )}
        </div>
      )}
      <div className="bg-white border rounded-xl overflow-hidden">
        {hasAnySent ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {hasSelectionActions && (
                  <th className="w-12 px-3 py-3">
                    <button onClick={toggleAll} className="text-gray-600 hover:text-purple-600" title="Tümünü seç">
                      {allSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                    </button>
                  </th>
                )}
                <th className="text-left px-4 py-3 font-semibold text-gray-700 text-xs uppercase">IWASKU</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">FNSKU</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Ürün Adı</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Kategori</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Pazar Yeri</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Eklenme</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Miktar</th>
                <th className="text-center px-3 py-3 font-semibold text-gray-700 text-xs uppercase">Gönderim</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(item => (
                <tr key={item.id} className={`${selectedSentIds.has(item.id) ? 'bg-blue-50/50' : 'bg-green-50/30'}`}>
                  {hasSelectionActions && (
                    <td className="px-3 py-3">
                      <button onClick={() => toggleItem(item.id)} className="text-gray-500 hover:text-purple-600">
                        {selectedSentIds.has(item.id)
                          ? <CheckSquare className="w-5 h-5 text-purple-600" />
                          : <Square className="w-5 h-5" />}
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3 font-mono text-sm text-gray-900">{item.iwasku}</td>
                  <td className="px-3 py-3 font-mono text-sm text-gray-600">{item.fnsku || '—'}</td>
                  <td className="px-3 py-3 text-xs text-gray-700 line-clamp-1">{item.productName || '—'}</td>
                  <td className="px-3 py-3 text-sm text-gray-600">{item.productCategory || '—'}</td>
                  <td className="px-3 py-3 text-sm text-gray-600">{item.marketplace?.name ?? '—'}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {new Date(item.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                  </td>
                  <td className="text-center px-3 py-3 font-semibold text-gray-900">{item.quantity}</td>
                  <td className="text-center px-3 py-3 text-xs text-green-700">
                    {item.sentAt ? new Date(item.sentAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-12">
            <Ship className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Henüz gönderilen ürün yok</p>
          </div>
        )}
      </div>
    </div>
  );
}
