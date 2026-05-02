/**
 * SINGLE sipariş için kalem ekleme paneli — sipariş detay sayfasında render edilir.
 * Ürün autocomplete → konumlarını listele → her konumdan miktar girerek ekle.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Package, Box as BoxIcon, AlertCircle, Sparkles, Loader2 } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { suggestPick, type PickCandidate, type PickSuggestion } from '@/lib/wms/fifoSuggest';

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
  createdAt: string;
}

interface BoxLocation {
  id: string;
  shelfId: string;
  shelfCode: string;
  shelfType: string;
  boxNumber: string;
  fnsku: string | null;
  marketplaceCode: string | null;
  destination: string;
  quantity: number;
  reservedQty: number;
  availableQty: number;
  status: string;
  arrivedAt: string;
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
  const [needQty, setNeedQty] = useState<number>(1);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [shelfFilter, setShelfFilter] = useState<string>('');

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
    setNeedQty(1);
    setShelfFilter('');
  }

  // FIFO candidate listesi (filtered + suggest input)
  const candidates: PickCandidate[] = useMemo(() => {
    if (!locations) return [];
    const list: PickCandidate[] = [];
    for (const s of locations.stocks) {
      if (shelfFilter && !s.shelfCode.toUpperCase().includes(shelfFilter.toUpperCase())) continue;
      list.push({
        source: 'STOCK',
        locationId: s.id,
        shelfId: s.shelfId,
        shelfCode: s.shelfCode,
        shelfType: s.shelfType,
        availableQty: s.availableQty,
        ageReference: new Date(s.createdAt),
      });
    }
    for (const b of locations.boxes) {
      if (shelfFilter && !b.shelfCode.toUpperCase().includes(shelfFilter.toUpperCase())) continue;
      list.push({
        source: 'BOX',
        locationId: b.id,
        shelfId: b.shelfId,
        shelfCode: b.shelfCode,
        shelfType: b.shelfType,
        availableQty: b.availableQty,
        ageReference: new Date(b.arrivedAt),
        boxNumber: b.boxNumber,
        fnsku: b.fnsku,
        marketplaceCode: b.marketplaceCode,
        status: b.status,
      });
    }
    return list;
  }, [locations, shelfFilter]);

  const suggestion = useMemo(() => suggestPick(candidates, needQty), [candidates, needQty]);

  async function postItem(payload: Record<string, unknown>) {
    const res = await fetch(`/api/depolar/${warehouseCode}/siparis/${orderId}/items`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (!res.ok || !d.success) throw new Error(d.error || 'Eklenemedi');
    return d;
  }

  async function applySuggestions(suggestions: PickSuggestion[]) {
    if (suggestions.length === 0 || !selectedProduct) return;
    setBulkAdding(true);
    setError(null);
    try {
      for (const s of suggestions) {
        if (s.source === 'STOCK') {
          await postItem({
            shelfId: candidates.find((c) => c.locationId === s.locationId)?.shelfId,
            iwasku: selectedProduct.iwasku,
            quantity: s.suggestedQty,
          });
        } else {
          await postItem({ shelfBoxId: s.locationId, quantity: s.suggestedQty });
        }
      }
      onSuccess();
      reset();
    } catch (e) {
      logger.error('Bulk apply suggestions', e);
      setError((e as Error).message || 'Toplu ekleme başarısız');
    } finally {
      setBulkAdding(false);
    }
  }

  async function addStockItem(loc: StockLocation, qty: number) {
    setError(null);
    if (qty <= 0 || qty > loc.availableQty) {
      setError(`Geçersiz miktar (max ${loc.availableQty})`);
      return;
    }
    try {
      await postItem({
        shelfId: loc.shelfId,
        iwasku: selectedProduct!.iwasku,
        quantity: qty,
      });
      onSuccess();
      reset();
    } catch (e) {
      logger.error('Add stock item', e);
      setError((e as Error).message || 'Sunucu hatası');
    }
  }

  async function addBoxItem(box: BoxLocation, qty: number) {
    setError(null);
    if (qty <= 0 || qty > box.availableQty) {
      setError(`Geçersiz miktar (max ${box.availableQty})`);
      return;
    }
    try {
      await postItem({ shelfBoxId: box.id, quantity: qty });
      onSuccess();
      reset();
    } catch (e) {
      logger.error('Add box item', e);
      setError((e as Error).message || 'Sunucu hatası');
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

          {/* Pick controls: hedef miktar + filtre */}
          {locations && (locations.stocks.length > 0 || locations.boxes.length > 0) && (
            <div className="bg-white border border-blue-200 rounded p-2.5 flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-gray-700">
                İhtiyaç:
                <input
                  type="number"
                  min="1"
                  value={needQty}
                  onChange={(e) => setNeedQty(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-right"
                />
                <span className="text-gray-500">adet</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-700">
                Konum filtre:
                <input
                  type="text"
                  value={shelfFilter}
                  onChange={(e) => setShelfFilter(e.target.value)}
                  placeholder="örn. A-01"
                  className="w-32 px-2 py-1 border border-gray-300 rounded text-sm font-mono"
                />
              </label>
            </div>
          )}

          {/* FIFO öneri paneli */}
          {locations && candidates.length > 0 && suggestion.suggestions.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded">
              <div className="px-3 py-2 border-b border-emerald-100 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-900">
                  <Sparkles className="w-3.5 h-3.5" />
                  Sistem önerisi (FIFO)
                  {suggestion.remaining > 0 && (
                    <span className="ml-2 text-amber-700">
                      {suggestion.remaining} adet karşılanamıyor (yetersiz stok)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => applySuggestions(suggestion.suggestions)}
                  disabled={bulkAdding || suggestion.remaining > 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title={
                    suggestion.remaining > 0
                      ? 'Tam karşılanamadığı için toplu ekleme kapalı'
                      : 'Önerilen tüm konumlardan otomatik ekle'
                  }
                >
                  {bulkAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Tümünü Ekle ({suggestion.suggestions.reduce((s, x) => s + x.suggestedQty, 0)})
                </button>
              </div>
              <ul className="divide-y divide-emerald-100">
                {suggestion.suggestions.map((s) => (
                  <li key={`${s.source}-${s.locationId}`} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold">
                      {s.order}
                    </span>
                    <span className="font-mono font-medium text-gray-900">{s.shelfCode}</span>
                    {s.boxNumber && (
                      <span className="font-mono text-gray-500">@ {s.boxNumber}</span>
                    )}
                    <span className="text-gray-500 truncate flex-1">{s.rationale}</span>
                    <span className="font-medium text-emerald-800">{s.suggestedQty} adet</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
              {locations.stocks.filter((s) => !shelfFilter || s.shelfCode.toUpperCase().includes(shelfFilter.toUpperCase())).length > 0 && (
                <div className="bg-white border border-gray-200 rounded">
                  <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 text-xs text-gray-600">
                    <Package className="w-3 h-3" /> Tekil ürün
                  </div>
                  <div className="divide-y divide-gray-100">
                    {locations.stocks
                      .filter((s) => !shelfFilter || s.shelfCode.toUpperCase().includes(shelfFilter.toUpperCase()))
                      .map((s) => (
                      <LocationRow
                        key={s.id}
                        type="stock"
                        label={s.shelfCode}
                        sub={`${s.shelfType}`}
                        available={s.availableQty}
                        reserved={s.reservedQty}
                        defaultQty={Math.min(needQty, s.availableQty)}
                        onAdd={(q) => addStockItem(s, q)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Boxes */}
              {locations.boxes.filter((b) => !shelfFilter || b.shelfCode.toUpperCase().includes(shelfFilter.toUpperCase())).length > 0 && (
                <div className="bg-white border border-gray-200 rounded">
                  <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 text-xs text-gray-600">
                    <BoxIcon className="w-3 h-3" /> Koli
                  </div>
                  <div className="divide-y divide-gray-100">
                    {locations.boxes
                      .filter((b) => !shelfFilter || b.shelfCode.toUpperCase().includes(shelfFilter.toUpperCase()))
                      .map((b) => (
                      <LocationRow
                        key={b.id}
                        type="box"
                        label={b.boxNumber}
                        sub={`@ ${b.shelfCode} • ${b.status}${b.marketplaceCode ? ' • ' + b.marketplaceCode : ''}`}
                        available={b.availableQty}
                        reserved={b.reservedQty}
                        defaultQty={Math.min(needQty, b.availableQty)}
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
  defaultQty?: number;
  onAdd: (qty: number) => void | Promise<void>;
}

function LocationRow({ type, label, sub, available, reserved, defaultQty, onAdd }: LocationRowProps) {
  const initial = Math.max(1, Math.min(defaultQty ?? available, available));
  const [qty, setQty] = useState<number>(initial);
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
