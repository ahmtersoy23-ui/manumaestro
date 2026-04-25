/**
 * Raf Düzeni Sekmesi — raf grid + canlı arama.
 * Read-only v1: rafları liste ve arama. Yazma operasyonları (yeni raf, transfer,
 * koli aç/parçala, manuel koli) sonraki commit'lerde gelecek.
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { Search, Layers, Package, Box, AlertCircle } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RafSekmesi');

interface ShelfRow {
  id: string;
  code: string;
  shelfType: 'POOL' | 'TEMP' | 'NORMAL';
  notes: string | null;
  summary: {
    looseLines: number; looseQty: number; looseReserved: number;
    sealedBoxes: number; sealedQty: number;
    partialBoxes: number; partialQty: number;
  };
}

interface SearchResult {
  query: string;
  shelves: { id: string; code: string; shelfType: string }[];
  stocks: {
    id: string; shelfId: string; shelfCode: string; shelfType: string;
    iwasku: string; productName: string | null;
    quantity: number; reservedQty: number;
  }[];
  boxes: {
    id: string; shelfId: string; shelfCode: string; shelfType: string;
    boxNumber: string; iwasku: string; productName: string | null;
    fnsku: string | null; quantity: number; status: string;
  }[];
}

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  POOL: { label: 'Havuz', cls: 'bg-purple-100 text-purple-700' },
  TEMP: { label: 'Geçici', cls: 'bg-amber-100 text-amber-700' },
  NORMAL: { label: 'Normal', cls: 'bg-gray-100 text-gray-600' },
};

export default function RafPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();

  const [shelves, setShelves] = useState<ShelfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'POOL' | 'TEMP' | 'NORMAL'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  // Rafları yükle — setLoading(true) initial state ile geliyor; refetch sırasında
  // mevcut veri gözükmeye devam eder, fetch tamamlanınca güncellenir.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (typeFilter !== 'ALL') params.set('shelfType', typeFilter);
    fetch(`/api/depolar/${code}/raflar?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setShelves(d.data.shelves);
        else setError(d.error || 'Raflar yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Raf fetch error', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, typeFilter]);

  // Debounced arama — q < 2 ise fetch yapma; UI tarafı searchTerm'e göre derived
  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      setSearching(true);
      fetch(`/api/depolar/${code}/arama?q=${encodeURIComponent(q)}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.success) setSearchResults(d.data);
        })
        .catch((e) => logger.error('Arama hatası', e))
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [searchTerm, code]);

  // Arama görünürlüğü term uzunluğundan türetilir (state'i sıfırlamak yerine)
  const isSearching = searchTerm.trim().length >= 2;
  const visibleSearchResults = isSearching ? searchResults : null;

  const totalShelves = shelves.length;
  const totalLooseQty = shelves.reduce((s, r) => s + r.summary.looseQty, 0);
  const totalSealedBoxes = shelves.reduce((s, r) => s + r.summary.sealedBoxes, 0);
  const totalPartialBoxes = shelves.reduce((s, r) => s + r.summary.partialBoxes, 0);

  return (
    <div className="space-y-5">
      {/* Arama */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Raf kodu / SKU / FNSKU / koli no — en az 2 karakter"
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
          autoComplete="off"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            Aranıyor…
          </span>
        )}
      </div>

      {/* Arama sonuçları */}
      {visibleSearchResults && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-medium text-gray-700">
            Arama: <span className="font-mono">{visibleSearchResults.query}</span>
          </h3>

          {visibleSearchResults.shelves.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">
                Eşleşen raflar ({visibleSearchResults.shelves.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {visibleSearchResults.shelves.map((s) => (
                  <Link
                    key={s.id}
                    href={`/dashboard/depolar/${code}/raf/${encodeURIComponent(s.code)}`}
                    className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-mono"
                  >
                    {s.code}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {visibleSearchResults.stocks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">
                Tekil ürün ({visibleSearchResults.stocks.length})
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <th className="text-left py-1">Raf</th>
                      <th className="text-left py-1">SKU</th>
                      <th className="text-left py-1">Ürün</th>
                      <th className="text-right py-1">Adet</th>
                      <th className="text-right py-1">Rezerve</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleSearchResults.stocks.map((s) => (
                      <tr key={s.id}>
                        <td className="py-1.5">
                          <Link
                            href={`/dashboard/depolar/${code}/raf/${encodeURIComponent(s.shelfCode)}`}
                            className="font-mono text-xs text-blue-700 hover:underline"
                          >
                            {s.shelfCode}
                          </Link>
                        </td>
                        <td className="py-1.5 font-mono text-xs">{s.iwasku}</td>
                        <td className="py-1.5 text-xs text-gray-600 truncate max-w-[300px]">
                          {s.productName ?? '—'}
                        </td>
                        <td className="py-1.5 text-right">{s.quantity}</td>
                        <td className="py-1.5 text-right text-amber-600">
                          {s.reservedQty > 0 ? s.reservedQty : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {visibleSearchResults.boxes.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">
                Koli ({visibleSearchResults.boxes.length})
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <th className="text-left py-1">Raf</th>
                      <th className="text-left py-1">Koli No</th>
                      <th className="text-left py-1">SKU</th>
                      <th className="text-left py-1">Ürün</th>
                      <th className="text-right py-1">Adet</th>
                      <th className="text-left py-1">Durum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleSearchResults.boxes.map((b) => (
                      <tr key={b.id}>
                        <td className="py-1.5">
                          <Link
                            href={`/dashboard/depolar/${code}/raf/${encodeURIComponent(b.shelfCode)}`}
                            className="font-mono text-xs text-blue-700 hover:underline"
                          >
                            {b.shelfCode}
                          </Link>
                        </td>
                        <td className="py-1.5 font-mono text-xs">{b.boxNumber}</td>
                        <td className="py-1.5 font-mono text-xs">{b.iwasku}</td>
                        <td className="py-1.5 text-xs text-gray-600 truncate max-w-[280px]">
                          {b.productName ?? '—'}
                        </td>
                        <td className="py-1.5 text-right">{b.quantity}</td>
                        <td className="py-1.5">
                          <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                            b.status === 'SEALED' ? 'bg-green-100 text-green-700' :
                            b.status === 'PARTIAL' ? 'bg-amber-100 text-amber-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {b.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {visibleSearchResults.shelves.length === 0 &&
            visibleSearchResults.stocks.length === 0 &&
            visibleSearchResults.boxes.length === 0 && (
              <p className="text-sm text-gray-400">Eşleşen kayıt yok.</p>
            )}
        </div>
      )}

      {/* Filtre + özet */}
      {!visibleSearchResults && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex gap-1 text-sm">
              {(['ALL', 'POOL', 'TEMP', 'NORMAL'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                    typeFilter === t
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t === 'ALL' ? 'Hepsi' : TYPE_BADGE[t]?.label ?? t}
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-500">
              {totalShelves} raf • {totalLooseQty} tekil • {totalSealedBoxes} mühürlü koli
              {totalPartialBoxes > 0 && ` • ${totalPartialBoxes} kısmi`}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-gray-500">Raflar yükleniyor…</div>
          ) : shelves.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500">
              <Layers className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              Bu filtreyle eşleşen raf yok.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {shelves.map((s) => {
                const badge = TYPE_BADGE[s.shelfType] ?? TYPE_BADGE.NORMAL;
                const totalQty = s.summary.looseQty + s.summary.sealedQty + s.summary.partialQty;
                return (
                  <Link
                    key={s.id}
                    href={`/dashboard/depolar/${code}/raf/${encodeURIComponent(s.code)}`}
                    className="block bg-white border border-gray-200 rounded-lg p-3 hover:border-blue-400 hover:shadow-sm transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-semibold text-gray-900">{s.code}</span>
                      <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="mt-2 text-[11px] text-gray-500 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1"><Package className="w-3 h-3" /> Tekil</span>
                        <span className="text-gray-700 font-medium">{s.summary.looseQty}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1"><Box className="w-3 h-3" /> Koli</span>
                        <span className="text-gray-700 font-medium">
                          {s.summary.sealedBoxes + s.summary.partialBoxes}
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-t border-gray-100 pt-1 mt-1">
                        <span className="text-gray-400">Toplam</span>
                        <span className="font-semibold text-gray-900">{totalQty}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
