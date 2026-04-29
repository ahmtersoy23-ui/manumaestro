/**
 * Raf Düzeni Sekmesi — raf grid + canlı arama + yeni raf/koli operasyonları.
 */

'use client';

import { useEffect, useState, use, useMemo } from 'react';
import Link from 'next/link';
import { Search, Layers, Package, Box, AlertCircle, Plus, PackagePlus, Layers3, AlertTriangle } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { NewShelfDialog } from '@/components/wms/NewShelfDialog';
import { BulkShelfDialog } from '@/components/wms/BulkShelfDialog';
import { ManualBoxDialog } from '@/components/wms/ManualBoxDialog';
import { UnmatchedSeedTable } from '@/components/wms/UnmatchedSeedTable';

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
  const [role, setRole] = useState<string>('VIEWER');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'POOL' | 'TEMP' | 'NORMAL'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<'NEW_SHELF' | 'BULK_SHELF' | 'MANUAL_BOX' | null>(null);
  const [view, setView] = useState<'shelves' | 'unmatched'>('shelves');
  const [pendingUnmatched, setPendingUnmatched] = useState<number>(0);

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
        if (d.success) {
          setShelves(d.data.shelves);
          setRole(d.data.role ?? 'VIEWER');
          setPendingUnmatched(d.data.pendingUnmatched ?? 0);
        } else setError(d.error || 'Raflar yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Raf fetch error', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, typeFilter, refreshKey]);

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

  // Yetki rozetleri — admin/manager/operator yazma yetkisi var
  const canCreateShelf = ['OPERATOR', 'MANAGER', 'ADMIN'].includes(role);
  const canBulkShelf = ['OPERATOR', 'MANAGER', 'ADMIN'].includes(role);
  const canManualBox = ['OPERATOR', 'MANAGER', 'ADMIN'].includes(role);
  const canResolveUnmatched = ['MANAGER', 'ADMIN'].includes(role);
  // Manuel koli sadece SHELF_PRIMARY depolarda mantıklı (NJ + SHOWROOM)
  const isShelfPrimaryWh = code === 'NJ' || code === 'SHOWROOM';

  // Raf code formatını parse et (örn. "A10-3" → wall:A, rack:10, level:3)
  const parseShelfCode = (rafCode: string) => {
    const m = rafCode.match(/^([A-Z]+)(\d+)-(\d+)$/);
    return m ? { wall: m[1], rack: parseInt(m[2], 10), level: parseInt(m[3], 10) } : null;
  };

  // Natural sort + Ankara için: Havuzlar (POOL) en üstte, sonra duvar bazlı koridorlar
  const groupedShelves = useMemo(() => {
    const sorted = [...shelves].sort((a, b) => {
      const pa = parseShelfCode(a.code);
      const pb = parseShelfCode(b.code);
      if (pa && pb) {
        if (pa.wall !== pb.wall) return pa.wall.localeCompare(pb.wall);
        if (pa.rack !== pb.rack) return pa.rack - pb.rack;
        return pa.level - pb.level;
      }
      return a.code.localeCompare(b.code);
    });
    if (code !== 'ANKARA') {
      return [{ key: 'all', label: null as string | null, items: sorted }];
    }
    // POOL rafları "Havuzlar" başlığı altında en üste, geri kalanlar duvar bazlı
    const poolItems = sorted.filter(s => s.shelfType === 'POOL');
    const others = sorted.filter(s => s.shelfType !== 'POOL');
    const groups: Array<{ key: string; label: string | null; items: typeof sorted }> = [];
    if (poolItems.length > 0) {
      groups.push({ key: 'POOL', label: 'Havuzlar', items: poolItems });
    }
    const wallGroups = new Map<string, typeof sorted>();
    for (const s of others) {
      const parsed = parseShelfCode(s.code);
      const key = parsed?.wall ?? 'Diğer';
      if (!wallGroups.has(key)) wallGroups.set(key, []);
      wallGroups.get(key)!.push(s);
    }
    const labels: Record<string, string> = { A: 'Sağ Koridor', B: 'Sol Koridor' };
    for (const [key, items] of wallGroups) {
      groups.push({ key, label: labels[key] ?? key, items });
    }
    return groups;
  }, [shelves, code]);

  const handleSuccess = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-5">
      {/* Sub-tab: Raflar | Eşleşmeyen */}
      {pendingUnmatched > 0 && (
        <div className="flex items-center gap-1 border-b border-gray-200">
          <button
            onClick={() => setView('shelves')}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              view === 'shelves'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Raflar
          </button>
          <button
            onClick={() => setView('unmatched')}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${
              view === 'unmatched'
                ? 'border-amber-600 text-amber-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Eşleşmeyen ({pendingUnmatched})
          </button>
        </div>
      )}

      {/* Eşleşmeyen view */}
      {view === 'unmatched' && pendingUnmatched > 0 && (
        <UnmatchedSeedTable
          warehouseCode={code}
          canResolve={canResolveUnmatched}
          refreshTick={refreshKey}
          onChange={handleSuccess}
        />
      )}

      {/* Raflar view (default) */}
      {view === 'shelves' && <>

      {/* Action butonları */}
      {(canCreateShelf || canBulkShelf || canManualBox) && (
        <div className="flex flex-wrap gap-2">
          {canCreateShelf && (
            <button
              onClick={() => setDialog('NEW_SHELF')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" /> Yeni Raf
            </button>
          )}
          {canBulkShelf && (
            <button
              onClick={() => setDialog('BULK_SHELF')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-700 rounded-md hover:bg-gray-50"
            >
              <Layers3 className="w-4 h-4" /> Toplu Raf
            </button>
          )}
          {canManualBox && isShelfPrimaryWh && (
            <button
              onClick={() => setDialog('MANUAL_BOX')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-700 rounded-md hover:bg-gray-50"
            >
              <PackagePlus className="w-4 h-4" /> Yeni Koli (Manuel)
            </button>
          )}
        </div>
      )}

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
            <div className="space-y-5">
              {groupedShelves.map((g) => (
                <div key={g.key}>
                  {g.label && (
                    <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">{g.label}</h3>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {g.items.map((s) => {
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
                </div>
              ))}
            </div>
          )}
        </>
      )}

      </>}

      {/* Modal'lar */}
      <NewShelfDialog
        isOpen={dialog === 'NEW_SHELF'}
        warehouseCode={code}
        onClose={() => setDialog(null)}
        onSuccess={handleSuccess}
      />
      <BulkShelfDialog
        isOpen={dialog === 'BULK_SHELF'}
        warehouseCode={code}
        onClose={() => setDialog(null)}
        onSuccess={handleSuccess}
      />
      <ManualBoxDialog
        isOpen={dialog === 'MANUAL_BOX'}
        warehouseCode={code}
        onClose={() => setDialog(null)}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
