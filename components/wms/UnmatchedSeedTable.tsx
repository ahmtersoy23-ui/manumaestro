/**
 * Eşleşmeyen Stok Tablosu — admin'in çözmesi için PENDING satırları.
 * Aksiyonlar: "Eşleştir" (ResolveUnmatchedDialog) ve "Atla".
 */

'use client';

import { useEffect, useState, useMemo } from 'react';
import { AlertCircle, Search, Check, SkipForward } from 'lucide-react';
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
  const [resolveSource, setResolveSource] = useState<UnmatchedSource | null>(null);
  const [skippingId, setSkippingId] = useState<string | null>(null);

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

  const groupMap = useMemo(() => new Map(groups.map((g) => [g.rawLookup, g])), [groups]);

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.rawLookup.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        r.shelfCode.toLowerCase().includes(q) ||
        (r.boxNumber ?? '').toLowerCase().includes(q)
    );
  }, [rows, filter]);

  async function skipRow(row: Row, applyToAll: boolean) {
    const confirmMsg = applyToAll
      ? `"${row.rawLookup}" için tüm ${groupMap.get(row.rawLookup)?.count ?? 1} satırı atla?`
      : 'Bu satırı atla?';
    if (!confirm(confirmMsg)) return;
    setSkippingId(row.id);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/unmatched/${row.id}/skip`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applyToAllSameLookup: applyToAll }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Atlanamadı');
        return;
      }
      onChange();
    } catch (e) {
      logger.error('Skip hatası', e);
      alert('Sunucu hatası');
    } finally {
      setSkippingId(null);
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
            placeholder="lookup, açıklama, raf veya koli no…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="text-xs text-gray-500">
          {filteredRows.length}/{rows.length} satır • {groups.length} unique lookup •{' '}
          toplam {rows.reduce((s, r) => s + r.quantity, 0)} adet
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">Raw Lookup</th>
              <th className="text-left px-3 py-2">Açıklama</th>
              <th className="text-left px-3 py-2">Raf</th>
              <th className="text-left px-3 py-2">Koli</th>
              <th className="text-right px-3 py-2">Adet</th>
              <th className="text-left px-3 py-2">Grup</th>
              {canResolve && <th className="text-right px-3 py-2 w-44">Aksiyon</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredRows.map((r) => {
              const grp = groupMap.get(r.rawLookup);
              const groupCount = grp?.count ?? 1;
              const groupTotalQty = grp?.totalQty ?? r.quantity;
              return (
                <tr key={r.id} className="text-gray-700">
                  <td className="px-3 py-2 font-mono text-xs">{r.rawLookup}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[280px]">
                    {r.description ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.shelfCode}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.boxNumber ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">{r.quantity}</td>
                  <td className="px-3 py-2 text-[11px] text-gray-500">
                    {groupCount > 1 ? `${groupCount} satır / ${groupTotalQty} adet` : '—'}
                  </td>
                  {canResolve && (
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() =>
                            setResolveSource({
                              id: r.id,
                              rawLookup: r.rawLookup,
                              description: r.description,
                              shelfCode: r.shelfCode,
                              boxNumber: r.boxNumber,
                              quantity: r.quantity,
                              groupCount,
                              groupTotalQty,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
                          title="iwasku ata ve çöz"
                        >
                          <Check className="w-3 h-3" /> Eşleştir
                        </button>
                        <button
                          onClick={() => skipRow(r, false)}
                          disabled={skippingId === r.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-600 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50"
                          title="Sadece bu satırı atla"
                        >
                          <SkipForward className="w-3 h-3" /> Atla
                        </button>
                        {groupCount > 1 && (
                          <button
                            onClick={() => skipRow(r, true)}
                            disabled={skippingId === r.id}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-red-700 bg-red-50 hover:bg-red-100 rounded disabled:opacity-50"
                            title={`Bu lookup'a ait ${groupCount} satırın hepsini atla`}
                          >
                            Hepsini Atla
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal */}
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
