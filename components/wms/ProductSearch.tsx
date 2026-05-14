/**
 * Reusable ürün arama bileşeni.
 * - Debounced text arama (iwasku / name)
 * - Kategori filtresi (opsiyonel dropdown — kategori seçilirse arama
 *   2 karakter altı sorgularla da çalışır, kategoriye göre listeler)
 * - Seçilen ürün rozet olarak gösterilir, "Değiştir" ile sıfırlanır
 *
 * Tüm WMS dialog'larında bu pattern tek noktadan kullanılır:
 * ManualBoxDialog, LooseStockDialog, TransferSourcePicker, DeleteStockDialog,
 * SiparişYeni satırları, vb.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ProductSearch');

export interface ProductHit {
  iwasku: string;
  name: string;
  category: string | null;
}

interface Props {
  // Seçili ürün (controlled). null/undefined → arama modu açık.
  selected: ProductHit | null;
  onSelect: (p: ProductHit) => void;
  onClear: () => void;
  // Otomatik focus (modal açılınca ilk input'a)
  autoFocus?: boolean;
  placeholder?: string;
  // Hangi context'te kullanıldığını gösterici label (form ARIA için)
  inputId?: string;
  // Boyut/yoğunluk
  compact?: boolean;
}

export function ProductSearch({
  selected,
  onSelect,
  onClear,
  autoFocus,
  placeholder = 'iwasku / FNSKU / ürün adı (en az 2 karakter)',
  inputId,
  compact,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<string>('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Kategorileri ilk mount'ta çek
  useEffect(() => {
    let cancelled = false;
    fetch('/api/products/categories', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setCategories(d.data || []);
      })
      .catch((e) => logger.error('Categories fetch', e));
    return () => {
      cancelled = true;
    };
  }, []);

  // Otomatik focus
  useEffect(() => {
    if (autoFocus && !selected) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [autoFocus, selected]);

  // Click-outside dropdown'u kapatır
  useEffect(() => {
    if (!showDropdown) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showDropdown]);

  // Debounced fetch — q veya category değişince
  useEffect(() => {
    const q = searchQuery.trim();
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      // q < 2 ve kategori yoksa hits temizle (timeout slot'unda — React 19 guard)
      if (q.length < 2 && !category) {
        setHits([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const params = new URLSearchParams();
      if (q.length >= 2) params.set('q', q);
      if (category) params.set('category', category);
      fetch(`/api/products/search?${params}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.success) setHits(d.data || []);
        })
        .catch(err => logger.error('product search failed', err))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchQuery, category]);

  if (selected) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-md bg-blue-50 text-sm">
        <span className="font-mono text-xs">{selected.iwasku}</span>
        <span className="text-gray-700 truncate flex-1">{selected.name}</span>
        {selected.category && (
          <span className="text-[10px] text-gray-500 bg-white px-1.5 py-0.5 rounded">
            {selected.category}
          </span>
        )}
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-blue-700 hover:underline"
        >
          Değiştir
        </button>
      </div>
    );
  }

  const padCls = compact ? 'py-1.5' : 'py-2';

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder={placeholder}
            className={`w-full pl-9 pr-3 ${padCls} border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400 text-gray-900`}
          />
        </div>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setShowDropdown(true);
          }}
          title="Kategori filtresi"
          className={`px-2 ${padCls} border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400 text-gray-900 max-w-[160px]`}
        >
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {showDropdown && (hits.length > 0 || loading) && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
          {loading && hits.length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-400 text-center">Aranıyor…</div>
          ) : (
            hits.map((p) => (
              <button
                key={p.iwasku}
                type="button"
                onClick={() => {
                  onSelect(p);
                  setShowDropdown(false);
                  setSearchQuery('');
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0 text-gray-900"
              >
                <div className="font-mono text-xs text-gray-500">{p.iwasku}</div>
                <div className="truncate">{p.name}</div>
                {p.category && (
                  <div className="text-[10px] text-gray-500 mt-0.5">{p.category}</div>
                )}
              </button>
            ))
          )}
        </div>
      )}
      {showDropdown &&
        !loading &&
        hits.length === 0 &&
        (searchQuery.trim().length >= 2 || category) && (
          <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg px-3 py-3 text-sm text-gray-400 text-center">
            Eşleşen ürün yok.
          </div>
        )}
    </div>
  );
}
