/**
 * Etiket Bas sayfası — tüm katalog ürünlerinden serbest etiket basımı.
 *
 * Talep olmayan ürünlerin de etiketlenebilmesi için (örn. spot üretim, yeniden
 * basım, deneme). Search bar IWASKU veya ürün adı ile filtreler, debounced.
 */

'use client';

import { useState, useEffect } from 'react';
import { Search, Printer, Loader2, Package } from 'lucide-react';
import { LabelPrintModal } from '@/components/labels/LabelPrintModal';

interface Product {
  iwasku: string;
  product_name: string;
  category: string | null;
}

export default function LabelsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [labelTarget, setLabelTarget] = useState<Product | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Load products on debounced search change
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/labels/products?search=${encodeURIComponent(debouncedSearch)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Ürünler yüklenemedi');
        }
        setProducts(json.data || []);
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
  }, [debouncedSearch]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Printer className="w-6 h-6 text-purple-600" />
          Etiket Bas
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Katalogdaki herhangi bir ürün için 100×30 mm QR etiketi bas. Talep olmayan ürünler de listede.
        </p>
      </div>

      <div className="relative mb-4">
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
              {debouncedSearch ? `"${debouncedSearch}" için sonuç yok` : 'Ürün bulunamadı'}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  IWASKU
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Ürün Adı
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Kategori
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider w-20">
                  {/* Aksiyon */}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {products.map((p) => (
                <tr key={p.iwasku} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm font-mono text-gray-900">{p.iwasku}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-800">{p.product_name}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {p.category ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700">
                        {p.category}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
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

        {!loading && products.length === 50 && (
          <div className="px-4 py-3 text-xs text-gray-500 bg-gray-50 border-t border-gray-200">
            İlk 50 sonuç gösteriliyor — daha fazla sonuç için aramayı daraltın.
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
