/**
 * Yeni Sipariş Yarat — DRAFT yaratma formu.
 * Type query'den okunur: ?type=SINGLE | FBA_PICKUP
 * SINGLE akışı: marketplace prefill (?marketplace=...) + sipariş no + ürün satırları + adres notu
 *   → tek POST, order + items birlikte yaratılır → /siparis listesine döner.
 * FBA_PICKUP akışı: eski yapı (önce yarat → detayda kolileri ekle).
 */

'use client';

import { useEffect, useState, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, AlertCircle, Box as BoxIcon, Plus, Trash2, Search } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('YeniSiparis');

interface Marketplace {
  code: string;
  name: string;
  marketplaceType?: string;
}

interface ProductHit {
  iwasku: string;
  name: string;
  category: string | null;
}

interface ItemRow {
  id: string; // local row id
  iwasku: string;
  display: string; // "iwasku — name"
  quantity: number | '';
}

const newRow = (): ItemRow => ({
  id: Math.random().toString(36).slice(2),
  iwasku: '',
  display: '',
  quantity: '',
});

export default function YeniSiparisPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderType = (searchParams.get('type') === 'FBA_PICKUP' ? 'FBA_PICKUP' : 'SINGLE') as
    | 'SINGLE'
    | 'FBA_PICKUP';
  const prefilledMarketplace = searchParams.get('marketplace') ?? '';

  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [marketplaceCode, setMarketplaceCode] = useState(prefilledMarketplace);
  const [orderNumber, setOrderNumber] = useState('');
  const [description, setDescription] = useState('');
  const [addressNote, setAddressNote] = useState('');
  const [items, setItems] = useState<ItemRow[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/marketplaces?limit=200', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          let list = (d.data || []) as Marketplace[];
          if (orderType === 'FBA_PICKUP') {
            list = list.filter((m) => m.code.startsWith('AMZN_') || m.marketplaceType === 'AMAZON');
          }
          setMarketplaces(list);
        }
      })
      .catch((e) => logger.error('Marketplaces fetch', e));
    return () => {
      cancelled = true;
    };
  }, [orderType]);

  const addRow = () => setItems((prev) => [...prev, newRow()]);
  const removeRow = (id: string) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));
  const updateRow = (id: string, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function handleSubmit() {
    setError(null);
    if (!marketplaceCode) return setError('Marketplace seçin');
    if (!orderNumber.trim())
      return setError(orderType === 'FBA_PICKUP' ? 'Pickup ID girin' : 'Sipariş no girin');

    let itemsPayload: { iwasku: string; quantity: number }[] | undefined;
    if (orderType === 'SINGLE') {
      // Boş satırları at, kalanların hepsi geçerli mi kontrol et
      const cleaned = items
        .map((r) => ({ iwasku: r.iwasku.trim(), quantity: typeof r.quantity === 'number' ? r.quantity : 0 }))
        .filter((r) => r.iwasku || r.quantity);
      if (cleaned.length === 0) return setError('En az 1 ürün satırı girin');
      for (const r of cleaned) {
        if (!r.iwasku) return setError('Tüm satırlarda ürün seçin');
        if (!r.quantity || r.quantity <= 0) return setError('Tüm satırlarda adet girin');
      }
      itemsPayload = cleaned;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${code}/siparis`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderType,
          marketplaceCode,
          orderNumber: orderNumber.trim(),
          description: description.trim() || undefined,
          addressNote: addressNote.trim() || undefined,
          items: itemsPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Sipariş yaratılamadı');
        return;
      }
      // SINGLE: listeye dön (kargo bekleyen kovasında); FBA_PICKUP: detaya git (koli ekleyecek)
      if (orderType === 'FBA_PICKUP') {
        router.push(`/dashboard/depolar/${code}/siparis/${data.data.id}`);
      } else {
        router.push(`/dashboard/depolar/${code}/siparis?stage=kargo`);
      }
    } catch (e) {
      logger.error('Submit hatası', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link
        href={`/dashboard/depolar/${code}/siparis`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <ChevronLeft className="w-4 h-4" /> Sipariş Çıkış
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          {orderType === 'FBA_PICKUP' ? (
            <>
              <BoxIcon className="w-5 h-5 text-orange-500" /> Yeni FBA Pick-up
            </>
          ) : (
            'Yeni Tekil Sipariş'
          )}
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          {orderType === 'FBA_PICKUP'
            ? 'Amazon FBA için koli bazlı pick-up. Önce sipariş yarat, sonra kolileri listeden ekle.'
            : 'Sipariş no + ürün/miktar + adres notu. Yaratıldıktan sonra "Kargo etiketi bekleyen" kovasına düşer.'}
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {orderType === 'FBA_PICKUP' ? 'Pazaryeri (Amazon)' : 'Pazaryeri'}
            </label>
            <select
              value={marketplaceCode}
              onChange={(e) => setMarketplaceCode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            >
              <option value="">Seçin…</option>
              {marketplaces.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code} — {m.name}
                </option>
              ))}
            </select>
            {orderType === 'FBA_PICKUP' && marketplaces.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">Amazon pazaryeri bulunamadı.</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {orderType === 'FBA_PICKUP' ? 'Pickup / Appointment ID' : 'Sipariş No'}
            </label>
            <input
              type="text"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder={
                orderType === 'FBA_PICKUP'
                  ? 'örn. APPT-2026-04-26-001'
                  : 'örn. 902-1234567-8901234'
              }
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:border-blue-400"
              autoComplete="off"
            />
          </div>
        </div>

        {/* SINGLE ürün satırları */}
        {orderType === 'SINGLE' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-gray-700">Ürünler *</label>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
              >
                <Plus className="w-3 h-3" /> Satır Ekle
              </button>
            </div>
            <div className="space-y-2">
              {items.map((row) => (
                <ItemRowInput
                  key={row.id}
                  row={row}
                  canRemove={items.length > 1}
                  onChange={(patch) => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* SINGLE adres notu */}
        {orderType === 'SINGLE' && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Adres / Açıklama
            </label>
            <textarea
              value={addressNote}
              onChange={(e) => setAddressNote(e.target.value)}
              rows={3}
              placeholder="Müşteri adresi, kargo notu, vb."
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
        )}

        {/* FBA için kısa açıklama */}
        {orderType === 'FBA_PICKUP' && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Açıklama (opsiyonel)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-3 h-3" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Link
            href={`/dashboard/depolar/${code}/siparis`}
            className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            İptal
          </Link>
          <button
            onClick={handleSubmit}
            disabled={submitting || !marketplaceCode || !orderNumber.trim()}
            className={`px-3 py-1.5 text-sm text-white rounded-md disabled:opacity-50 ${
              orderType === 'FBA_PICKUP'
                ? 'bg-orange-500 hover:bg-orange-600'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {submitting ? 'Yaratılıyor…' : orderType === 'FBA_PICKUP' ? 'Sipariş Yarat (DRAFT)' : 'Sipariş Yarat'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ItemRowInputProps {
  row: ItemRow;
  canRemove: boolean;
  onChange: (patch: Partial<ItemRow>) => void;
  onRemove: () => void;
}

function ItemRowInput({ row, canRemove, onChange, onRemove }: ItemRowInputProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const select = (p: ProductHit) => {
    onChange({ iwasku: p.iwasku, display: `${p.iwasku} — ${p.name}` });
    setSearchQuery('');
    setShowDropdown(false);
  };

  const clearProduct = () => {
    onChange({ iwasku: '', display: '' });
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="flex gap-2 items-start">
      <div className="flex-1 relative">
        {row.display ? (
          <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-md bg-blue-50 text-sm">
            <span className="font-mono text-xs">{row.iwasku}</span>
            <span className="text-gray-700 truncate flex-1">{row.display.split(' — ')[1]}</span>
            <button type="button" onClick={clearProduct} className="text-xs text-blue-700 hover:underline">
              Değiştir
            </button>
          </div>
        ) : (
          <>
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
              <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
                {hits.map((p) => (
                  <button
                    key={p.iwasku}
                    type="button"
                    onClick={() => select(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-mono text-xs text-gray-500">{p.iwasku}</div>
                    <div className="text-gray-800 truncate">{p.name}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <input
        type="number"
        min="1"
        value={row.quantity}
        onChange={(e) => onChange({ quantity: e.target.value === '' ? '' : Number(e.target.value) })}
        placeholder="Adet"
        className="w-24 px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        title={canRemove ? 'Satırı sil' : ''}
        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
