/**
 * Etiket Bas sayfası — tüm katalog ürünlerinden serbest etiket basımı.
 *
 * Search bar + kategori + parent filtreleri + pagination (50/sayfa).
 * Talebi olmayan ürünler de listede (spot üretim, yeniden basım vb.).
 */

'use client';

import { useState, useEffect } from 'react';
import { Search, Printer, Loader2, Package, ChevronLeft, ChevronRight } from 'lucide-react';
import { LabelPrintModal } from '@/components/labels/LabelPrintModal';

interface Product {
  iwasku: string;
  product_name: string;
  category: string | null;
  parent: string | null;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function LabelsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [parent, setParent] = useState('');
  const [page, setPage] = useState(1);

  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<string[]>([]);
  const [parents, setParents] = useState<string[]>([]);

  const [labelTarget, setLabelTarget] = useState<Product | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Filter (kategori/parent/search) değişince sayfa 1'e dön
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, category, parent]);

  // Kategori değişince parent sıfırlansın + parent listesi yenilenecek
  useEffect(() => {
    setParent('');
  }, [category]);

  // Filtre listelerini yükle (kategori + parent — parent kategoriye bağlı)
  useEffect(() => {
    let cancelled = false;
    async function loadFilters() {
      try {
        const url = `/api/labels/products/filters${category ? `?category=${encodeURIComponent(category)}` : ''}`;
        const res = await fetch(url);
        const json = await res.json();
        if (cancelled || !res.ok || !json.success) return;
        setCategories(json.data.categories || []);
        setParents(json.data.parents || []);
      } catch {
        /* noop */
      }
    }
    loadFilters();
    return () => {
      cancelled = true;
    };
  }, [category]);

  // Ürünleri yükle
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (category) params.set('category', category);
        if (parent) params.set('parent', parent);
        params.set('page', String(page));

        const res = await fetch(`/api/labels/products?${params.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Ürünler yüklenemedi');
        }
        setProducts(json.data || []);
        setPagination(json.pagination || null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, category, parent, page]);

  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  const filtersActive = !!(debouncedSearch || category || parent);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Printer className="w-6 h-6 text-purple-600" />
          Etiket Bas
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Katalogdaki herhangi bir ürün için 100×30 mm QR etiketi bas.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="IWASKU veya ürün adı ile ara..."
          autoFocus
          className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 text-sm"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 text-sm bg-white min-w-[180px]"
          aria-label="Kategori filtresi"
        >
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={parent}
          onChange={(e) => setParent(e.target.value)}
          disabled={!category}
          className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 text-sm bg-white min-w-[200px] disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          aria-label="Parent filtresi"
          title={!category ? 'Önce kategori seçin' : 'Parent ürün ailesi'}
        >
          <option value="">{category ? 'Tüm parent\'lar' : 'Önce kategori seç'}</option>
          {parents.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        {filtersActive && (
          <button
            type="button"
            onClick={() => { setSearch(''); setCategory(''); setParent(''); }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Filtreleri temizle
          </button>
        )}

        <div className="ml-auto flex items-center text-sm text-gray-500">
          {loading ? '…' : `${total.toLocaleString('tr-TR')} ürün`}
        </div>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Ürünler yükleniyor...
          </div>
        ) : error ? (
          <div className="p-6 text-red-700 bg-red-50">{error}</div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Package className="w-10 h-10 text-gray-300 mb-3" />
            <p className="text-sm text-gray-600">
              {filtersActive ? 'Bu filtrelerle eşleşen ürün yok' : 'Ürün bulunamadı'}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">IWASKU</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Ürün Adı</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Kategori</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Parent</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {products.map((p) => (
                <tr key={p.iwasku} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm font-mono text-gray-900">{p.iwasku}</span>
                  </td>
                  <td className="px-4 py-3"><span className="text-sm text-gray-800">{p.product_name}</span></td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {p.category ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700">{p.category}</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-500">{p.parent || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setLabelTarget(p)}
                      className="p-2 text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors"
                      title="Etiket Bas"
                      aria-label="Etiket Bas"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm">
            <div className="text-gray-600">
              {((page - 1) * 50) + 1}–{Math.min(page * 50, total)} / {total.toLocaleString('tr-TR')}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Önceki sayfa"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 font-semibold text-gray-700">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Sonraki sayfa"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {labelTarget && (
        <LabelPrintModal
          iwasku={labelTarget.iwasku}
          productName={labelTarget.product_name}
          onClose={() => setLabelTarget(null)}
        />
      )}
    </div>
  );
}
