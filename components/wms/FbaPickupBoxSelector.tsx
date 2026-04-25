/**
 * FBA Pick-up için koli seçim paneli — sipariş detay sayfasında render edilir.
 * NJ'de SEALED + reservedQty=0 + AMZN_* koli grid; tek tıkla siparişe ekler (tam koli).
 */

'use client';

import { useEffect, useState, useMemo } from 'react';
import { Search, AlertCircle, Box as BoxIcon, Plus, Filter } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('FbaPickupSelector');

interface FbaBox {
  id: string;
  boxNumber: string;
  iwasku: string;
  productName: string | null;
  fnsku: string | null;
  marketplaceCode: string | null;
  destination: string;
  quantity: number;
  shelfCode: string;
}

interface Props {
  warehouseCode: string;
  orderId: string;
  onSuccess: () => void;
  /** Eklenmiş kolilerin id'leri (parent'tan geliyor, devre dışı görünmek için) */
  alreadyAddedIds: Set<string>;
}

export function FbaPickupBoxSelector({ warehouseCode, orderId, onSuccess, alreadyAddedIds }: Props) {
  const [boxes, setBoxes] = useState<FbaBox[]>([]);
  const [marketplaces, setMarketplaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [marketplaceFilter, setMarketplaceFilter] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (marketplaceFilter) params.set('marketplaceCode', marketplaceFilter);
    fetch(`/api/depolar/${warehouseCode}/fba-koliler?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          setBoxes(d.data.boxes);
          setMarketplaces(d.data.marketplaces);
        } else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('FBA boxes fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warehouseCode, marketplaceFilter, refreshKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boxes;
    return boxes.filter(
      (b) =>
        b.boxNumber.toLowerCase().includes(q) ||
        b.iwasku.toLowerCase().includes(q) ||
        (b.fnsku ?? '').toLowerCase().includes(q) ||
        (b.productName ?? '').toLowerCase().includes(q) ||
        b.shelfCode.toLowerCase().includes(q)
    );
  }, [boxes, search]);

  async function addBox(box: FbaBox) {
    setError(null);
    setAdding(box.id);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/siparis/${orderId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shelfBoxId: box.id, quantity: box.quantity }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Eklenemedi');
        return;
      }
      onSuccess();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Add FBA box', e);
      setError('Sunucu hatası');
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-sm font-medium text-orange-900 flex items-center gap-2">
          <BoxIcon className="w-4 h-4" /> FBA Pick-up için Koli Seç
        </h3>
        <div className="text-xs text-orange-800">
          {boxes.length} uygun koli (SEALED + AMZN_*)
        </div>
      </div>

      {/* Filtre */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Koli no, SKU, FNSKU, ürün, raf"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-orange-400"
          />
        </div>
        {marketplaces.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <Filter className="w-3 h-3 text-gray-500" />
            <select
              value={marketplaceFilter}
              onChange={(e) => setMarketplaceFilter(e.target.value)}
              className="px-2 py-1.5 border border-gray-200 rounded-md text-xs"
            >
              <option value="">Tüm marketplace</option>
              {marketplaces.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-6 text-gray-500 text-sm">Yükleniyor…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-6 text-gray-500 text-sm bg-white rounded">
          {search || marketplaceFilter
            ? 'Filtreyle eşleşen uygun koli yok.'
            : 'Bu depoda FBA pick-up için uygun koli yok (SEALED + AMZN_* + rezervesiz).'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.map((box) => {
            const isAdded = alreadyAddedIds.has(box.id);
            return (
              <button
                key={box.id}
                onClick={() => addBox(box)}
                disabled={isAdded || adding === box.id}
                className={`text-left bg-white border rounded-md p-3 transition ${
                  isAdded
                    ? 'border-green-300 opacity-60'
                    : 'border-gray-200 hover:border-orange-400 hover:shadow-sm'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-semibold text-gray-900">{box.boxNumber}</span>
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                    {box.marketplaceCode}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-gray-500">{box.iwasku}</div>
                {box.productName && (
                  <div className="text-[11px] text-gray-700 truncate mt-0.5">{box.productName}</div>
                )}
                <div className="flex items-center justify-between mt-2 text-[11px]">
                  <span className="text-gray-500">@ {box.shelfCode}</span>
                  <span className="font-medium text-gray-900">{box.quantity} adet</span>
                </div>
                <div className="mt-2">
                  {isAdded ? (
                    <span className="text-[11px] text-green-700 font-medium">✓ Siparişte</span>
                  ) : adding === box.id ? (
                    <span className="text-[11px] text-orange-700">Ekleniyor…</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-orange-700">
                      <Plus className="w-3 h-3" /> Ekle (tüm koli)
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
