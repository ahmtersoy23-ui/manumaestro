/**
 * SINGLE sipariş için kalem ekleme paneli — sipariş detay sayfasında render edilir.
 * Ürün autocomplete → konumlarını listele → her konumdan miktar girerek ekle.
 */

'use client';

import { useEffect, useState } from 'react';
import { Search, Plus, Package, Box as BoxIcon, AlertCircle } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SingleItemAdder');

interface ProductHit {
  iwasku: string;
  name: string;
  category: string | null;
}

interface StockLocation {
  id: string;
  shelfId: string;
  shelfCode: string;
  shelfType: string;
  quantity: number;
  reservedQty: number;
  availableQty: number;
}

interface BoxLocation {
  id: string;
  shelfId: string;
  shelfCode: string;
  boxNumber: string;
  fnsku: string | null;
  marketplaceCode: string | null;
  destination: string;
  quantity: number;
  reservedQty: number;
  availableQty: number;
  status: string;
}

interface Locations {
  iwasku: string;
  stocks: StockLocation[];
  boxes: BoxLocation[];
}

interface Props {
  warehouseCode: string;
  orderId: string;
  onSuccess: () => void;
}

export function SingleOrderItemAdder({ warehouseCode, orderId, onSuccess }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [productHits, setProductHits] = useState<ProductHit[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductHit | null>(null);
  const [locations, setLocations] = useState<Locations | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounced product autocomplete — fetch sırasında state setter setTimeout içinde
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || selectedProduct) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      fetch(`/api/products/search?q=${encodeURIComponent(q)}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.success) setProductHits(d.data || []);
        })
        .catch((e) => logger.error('Product search', e));
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [searchQuery, selectedProduct]);

  // Ürün seçilince konumları getir — fetch içinde set, loading state derived
  useEffect(() => {
    if (!selectedProduct) return;
    let cancelled = false;
    fetch(
      `/api/depolar/${warehouseCode}/iwasku-konumlar?iwasku=${encodeURIComponent(selectedProduct.iwasku)}`,
      { credentials: 'include' }
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setLocations(d.data);
      })
      .catch((e) => logger.error('Locations fetch', e));
    return () => { cancelled = true; };
  }, [selectedProduct, warehouseCode]);

  // Loading: selectedProduct var ama henüz lokasyon gelmemiş
  const isLoadingLocations = selectedProduct !== null && locations?.iwasku !== selectedProduct.iwasku;

  function selectProduct(hit: ProductHit) {
    setSelectedProduct(hit);
    setSearchQuery('');
    setShowDropdown(false);
    setProductHits([]);
  }

  function reset() {
    setSelectedProduct(null);
    setLocations(null);
    setSearchQuery('');
    setError(null);
  }

  async function addStockItem(loc: StockLocation, qty: number) {
    setError(null);
    if (qty <= 0 || qty > loc.availableQty) {
      setError(`Geçersiz miktar (max ${loc.availableQty})`);
      return;
    }
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/siparis/${orderId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shelfId: loc.shelfId,
          iwasku: selectedProduct!.iwasku,
          quantity: qty,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Eklenemedi');
        return;
      }
      onSuccess();
      reset();
    } catch (e) {
      logger.error('Add stock item', e);
      setError('Sunucu hatası');
    }
  }

  async function addBoxItem(box: BoxLocation, qty: number) {
    setError(null);
    if (qty <= 0 || qty > box.availableQty) {
      setError(`Geçersiz miktar (max ${box.availableQty})`);
      return;
    }
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/siparis/${orderId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shelfBoxId: box.id, quantity: qty }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Eklenemedi');
        return;
      }
      onSuccess();
      reset();
    } catch (e) {
      logger.error('Add box item', e);
      setError('Sunucu hatası');
    }
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-blue-900">Kalem Ekle</h3>
        {selectedProduct && (
          <button onClick={reset} className="text-[11px] text-blue-700 hover:underline">
            Sıfırla
          </button>
        )}
      </div>

      {!selectedProduct ? (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            placeholder="iwasku veya ürün adı (en az 2 karakter)"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
          />
          {showDropdown && productHits.length > 0 && (
            <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
              {productHits.map((p) => (
                <button
                  key={p.iwasku}
                  type="button"
                  onClick={() => selectProduct(p)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                >
                  <div className="font-mono text-xs text-gray-500">{p.iwasku}</div>
                  <div className="text-gray-800 truncate">{p.name}</div>
                  {p.category && <div className="text-[10px] text-gray-400">{p.category}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Selected product banner */}
          <div className="bg-white border border-blue-200 rounded p-2 text-sm">
            <div className="font-mono text-xs text-gray-500">{selectedProduct.iwasku}</div>
            <div className="text-gray-800">{selectedProduct.name}</div>
          </div>

          {/* Locations */}
          {isLoadingLocations ? (
            <div className="text-sm text-gray-500 text-center py-3">Konumlar yükleniyor…</div>
          ) : !locations || (locations.stocks.length === 0 && locations.boxes.length === 0) ? (
            <div className="text-sm text-gray-500 text-center py-3 bg-white rounded">
              Bu ürünün depoda kullanılabilir konumu yok (hepsi rezerve veya boş).
            </div>
          ) : (
            <div className="space-y-2">
              {/* Stocks */}
              {locations.stocks.length > 0 && (
                <div className="bg-white border border-gray-200 rounded">
                  <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 text-xs text-gray-600">
                    <Package className="w-3 h-3" /> Tekil ürün ({locations.stocks.length})
                  </div>
                  <div className="divide-y divide-gray-100">
                    {locations.stocks.map((s) => (
                      <LocationRow
                        key={s.id}
                        type="stock"
                        label={s.shelfCode}
                        sub={`${s.shelfType}`}
                        available={s.availableQty}
                        reserved={s.reservedQty}
                        onAdd={(q) => addStockItem(s, q)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Boxes */}
              {locations.boxes.length > 0 && (
                <div className="bg-white border border-gray-200 rounded">
                  <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 text-xs text-gray-600">
                    <BoxIcon className="w-3 h-3" /> Koli ({locations.boxes.length})
                  </div>
                  <div className="divide-y divide-gray-100">
                    {locations.boxes.map((b) => (
                      <LocationRow
                        key={b.id}
                        type="box"
                        label={b.boxNumber}
                        sub={`@ ${b.shelfCode} • ${b.status}${b.marketplaceCode ? ' • ' + b.marketplaceCode : ''}`}
                        available={b.availableQty}
                        reserved={b.reservedQty}
                        onAdd={(q) => addBoxItem(b, q)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      )}
    </div>
  );
}

interface LocationRowProps {
  type: 'stock' | 'box';
  label: string;
  sub: string;
  available: number;
  reserved: number;
  onAdd: (qty: number) => void | Promise<void>;
}

function LocationRow({ type, label, sub, available, reserved, onAdd }: LocationRowProps) {
  const [qty, setQty] = useState<number>(available);
  const [adding, setAdding] = useState(false);

  return (
    <div className="px-3 py-2 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-gray-900">{label}</div>
        <div className="text-[10px] text-gray-500">{sub}</div>
      </div>
      <div className="text-right text-xs">
        <div className="font-medium text-gray-900">{available} kullanılabilir</div>
        {reserved > 0 && <div className="text-[10px] text-amber-600">{reserved} rezerve</div>}
      </div>
      <input
        type="number"
        min="1"
        max={available}
        value={qty}
        onChange={(e) => setQty(Number(e.target.value))}
        className="w-20 px-2 py-1 border border-gray-200 rounded text-sm text-right"
      />
      <button
        type="button"
        onClick={async () => {
          setAdding(true);
          try { await onAdd(qty); } finally { setAdding(false); }
        }}
        disabled={adding || qty <= 0 || qty > available}
        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] text-white rounded disabled:opacity-50 ${
          type === 'box' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        <Plus className="w-3 h-3" /> {adding ? '…' : 'Ekle'}
      </button>
    </div>
  );
}
