/**
 * Etiket Bas Client — search debounce + filter selects + pagination + modal.
 *
 * URL searchParams aktif state (parent Server Component bunu okur). Filter
 * değişikliği router.replace ile yeni RSC render tetikler. Debounce sadece
 * search input için.
 */

'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Search, Printer, Loader2, Package, ChevronLeft, ChevronRight } from 'lucide-react';

const LabelPrintModal = dynamic(
  () => import('@/components/labels/LabelPrintModal').then(m => ({ default: m.LabelPrintModal })),
  { ssr: false },
);

export interface ProductDTO {
  iwasku: string;
  product_name: string;
  category: string | null;
  parent: string | null;
  width: string | null;
  length: string | null;
  height: string | null;
  weight: string | null;
  verified_package: boolean | null;
}

export interface PaginationDTO {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface Props {
  initialProducts: ProductDTO[];
  pagination: PaginationDTO;
  categories: string[];
  parents: string[];
  currentSearch: string;
  currentCategory: string;
  currentParent: string;
}

const PAGE_SIZE = 50;

export function LabelsClient({
  initialProducts, pagination, categories, parents,
  currentSearch, currentCategory, currentParent,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(currentSearch);
  const [labelTarget, setLabelTarget] = useState<ProductDTO | null>(null);

  // Debounce search → URL update (sayfa 1'e döner)
  useEffect(() => {
    if (search === currentSearch) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (currentCategory) params.set('category', currentCategory);
      if (currentParent) params.set('parent', currentParent);
      startTransition(() => {
        router.replace(`/dashboard/labels${params.toString() ? `?${params}` : ''}`);
      });
    }, 350);
    return () => clearTimeout(t);
  }, [search, currentSearch, currentCategory, currentParent, router]);

  const updateFilter = (next: { category?: string; parent?: string; page?: number }) => {
    const params = new URLSearchParams();
    const nextCategory = next.category !== undefined ? next.category : currentCategory;
    const nextParent = next.parent !== undefined ? next.parent : (next.category !== undefined ? '' : currentParent);
    const nextPage = next.page ?? 1;
    if (search) params.set('search', search);
    if (nextCategory) params.set('category', nextCategory);
    if (nextParent) params.set('parent', nextParent);
    if (nextPage > 1) params.set('page', String(nextPage));
    startTransition(() => {
      router.replace(`/dashboard/labels${params.toString() ? `?${params}` : ''}`);
    });
  };

  const clearFilters = () => {
    setSearch('');
    startTransition(() => router.replace('/dashboard/labels'));
  };

  const total = pagination.total;
  const totalPages = pagination.totalPages;
  const page = pagination.page;
  const filtersActive = !!(currentSearch || currentCategory || currentParent);
  const loading = isPending;

  return (
    <>
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
          value={currentCategory}
          onChange={(e) => updateFilter({ category: e.target.value, parent: '' })}
          className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 text-sm bg-white min-w-[180px]"
          aria-label="Kategori filtresi"
        >
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={currentParent}
          onChange={(e) => updateFilter({ parent: e.target.value })}
          disabled={!currentCategory}
          className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 text-sm bg-white min-w-[200px] disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          aria-label="Parent filtresi"
          title={!currentCategory ? 'Önce kategori seçin' : 'Parent ürün ailesi'}
        >
          <option value="">{currentCategory ? 'Tüm parent\'lar' : 'Önce kategori seç'}</option>
          {parents.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
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
        ) : initialProducts.length === 0 ? (
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
              {initialProducts.map((p) => (
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
              {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} / {total.toLocaleString('tr-TR')}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => updateFilter({ page: Math.max(1, page - 1) })}
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
                onClick={() => updateFilter({ page: Math.min(totalPages, page + 1) })}
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
          width={labelTarget.width}
          length={labelTarget.length}
          height={labelTarget.height}
          weight={labelTarget.weight}
          verified={labelTarget.verified_package === true}
          onClose={() => setLabelTarget(null)}
        />
      )}
    </>
  );
}
