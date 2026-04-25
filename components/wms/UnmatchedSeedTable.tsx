/**
 * Eşleşmeyen Stok Tablosu — UNIQUE rawLookup bazlı görünüm.
 * Her satır 1 unique lookup; satıra tıklayınca o lookup'a ait alt satırlar (raf/koli) expand olur.
 * Aksiyonlar group başına: "Eşleştir (N satır)" + "Atla (N satır)".
 */

'use client';

import { useEffect, useState, useMemo } from 'react';
import { AlertCircle, Search, Check, SkipForward, ChevronRight, ChevronDown } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { ResolveUnmatchedDialog, type UnmatchedSource } from './ResolveUnmatchedDialog';

const logger = createLogger('UnmatchedSeedTable');

interface Row {
  id: string;
  warehouseCode: string;
  rawLookup: string;
  description: string | null;
  shelfCode: string;
  boxNumber: string | null;
  quantity: number;
  status: string;
  createdAt: string;
}
interface Group {
  rawLookup: string;
  count: number;
  totalQty: number;
  sampleDescription: string | null;
}

interface Props {
  warehouseCode: string;
  canResolve: boolean;
  refreshTick: number;
  onChange: () => void;
}

export function UnmatchedSeedTable({ warehouseCode, canResolve, refreshTick, onChange }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [resolveSource, setResolveSource] = useState<UnmatchedSource | null>(null);
  const [skippingLookup, setSkippingLookup] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/depolar/${warehouseCode}/unmatched?status=PENDING`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          setRows(d.data.rows);
          setGroups(d.data.groups);
        } else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Unmatched fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warehouseCode, refreshTick]);

  // Lookup başına satırları gruplama
  const rowsByLookup = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const arr = map.get(r.rawLookup) ?? [];
      arr.push(r);
      map.set(r.rawLookup, arr);
    }
    return map;
  }, [rows]);

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.rawLookup.toLowerCase().includes(q) ||
        (g.sampleDescription ?? '').toLowerCase().includes(q)
    );
  }, [groups, filter]);

  function toggleExpand(rawLookup: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rawLookup)) next.delete(rawLookup);
      else next.add(rawLookup);
      return next;
    });
  }

  async function skipGroup(group: Group) {
    if (!confirm(`"${group.rawLookup}" için ${group.count} satır (toplam ${group.totalQty} adet) atlanacak. Onaylıyor musun?`)) return;
    // İlk satırın id'si yeterli; applyToAllSameLookup=true backend tarafında kalanları siler
    const firstRow = rowsByLookup.get(group.rawLookup)?.[0];
    if (!firstRow) return;
    setSkippingLookup(group.rawLookup);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/unmatched/${firstRow.id}/skip`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applyToAllSameLookup: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Atlanamadı');
        return;
      }
      onChange();
    } catch (e) {
      logger.error('Skip group', e);
      alert('Sunucu hatası');
    } finally {
      setSkippingLookup(null);
    }
  }

  async function skipSingleRow(row: Row) {
    if (!confirm('Sadece bu satırı atla?')) return;
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/unmatched/${row.id}/skip`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applyToAllSameLookup: false }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Atlanamadı');
        return;
      }
      onChange();
    } catch (e) {
      logger.error('Skip single', e);
      alert('Sunucu hatası');
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Yükleniyor…</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  if (rows.length === 0)
    return (
      <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-500">
        <Check className="w-10 h-10 mx-auto text-green-400 mb-3" />
        <p className="text-sm">Eşleşmeyen kayıt yok — bu depodaki tüm seed satırları çözüldü.</p>
      </div>
    );

  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="space-y-4">
      {/* Filtre + özet */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="lookup veya açıklama"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="text-xs text-gray-500">
          {filteredGroups.length}/{groups.length} unique lookup • {rows.length} satır • {totalQty} adet
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="w-8 px-2"></th>
              <th className="text-left px-3 py-2">Raw Lookup</th>
              <th className="text-left px-3 py-2">Açıklama (örnek)</th>
              <th className="text-right px-3 py-2">Satır</th>
              <th className="text-right px-3 py-2">Toplam Adet</th>
              {canResolve && <th className="text-right px-3 py-2 w-44">Aksiyon</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredGroups.map((g) => {
              const isExpanded = expanded.has(g.rawLookup);
              const detailRows = rowsByLookup.get(g.rawLookup) ?? [];
              return (
                <>
                  <tr
                    key={g.rawLookup}
                    onClick={() => toggleExpand(g.rawLookup)}
                    className="text-gray-700 cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-2 text-gray-400">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{g.rawLookup}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[320px]">
                      {g.sampleDescription ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right">{g.count}</td>
                    <td className="px-3 py-2 text-right font-semibold">{g.totalQty}</td>
                    {canResolve && (
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              const first = detailRows[0];
                              if (!first) return;
                              setResolveSource({
                                id: first.id,
                                rawLookup: first.rawLookup,
                                description: first.description,
                                shelfCode: first.shelfCode,
                                boxNumber: first.boxNumber,
                                quantity: first.quantity,
                                groupCount: g.count,
                                groupTotalQty: g.totalQty,
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
                          >
                            <Check className="w-3 h-3" /> Eşleştir
                          </button>
                          <button
                            onClick={() => skipGroup(g)}
                            disabled={skippingLookup === g.rawLookup}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-600 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50"
                            title={`${g.count} satırın hepsini atla`}
                          >
                            <SkipForward className="w-3 h-3" /> Atla
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {isExpanded && (
                    <tr key={g.rawLookup + '-detail'} className="bg-gray-50">
                      <td colSpan={canResolve ? 6 : 5} className="px-6 py-2">
                        <table className="w-full text-xs">
                          <thead className="text-gray-500">
                            <tr>
                              <th className="text-left py-1">Raf</th>
                              <th className="text-left py-1">Koli</th>
                              <th className="text-right py-1">Adet</th>
                              <th className="text-left py-1">Açıklama</th>
                              {canResolve && <th className="text-right py-1 w-20">İşlem</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {detailRows.map((r) => (
                              <tr key={r.id} className="text-gray-700">
                                <td className="py-1.5 font-mono">{r.shelfCode}</td>
                                <td className="py-1.5 font-mono">{r.boxNumber ?? '—'}</td>
                                <td className="py-1.5 text-right">{r.quantity}</td>
                                <td className="py-1.5 truncate max-w-[260px] text-gray-500">
                                  {r.description ?? '—'}
                                </td>
                                {canResolve && (
                                  <td className="py-1.5 text-right">
                                    <button
                                      onClick={() => skipSingleRow(r)}
                                      className="text-[10px] text-red-700 bg-red-50 hover:bg-red-100 px-1.5 py-0.5 rounded"
                                    >
                                      Sil
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <ResolveUnmatchedDialog
        isOpen={!!resolveSource}
        warehouseCode={warehouseCode}
        source={resolveSource}
        onClose={() => setResolveSource(null)}
        onSuccess={onChange}
      />
    </div>
  );
}
