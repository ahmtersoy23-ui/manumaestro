'use client';

/**
 * Stok Haritası — iwasku bazında tüm lokasyonların ON-HAND stoğu (sadece görüntüleme).
 * Kaynak: GET /api/stok-haritasi (FBA + CG Shukran/MDN + US depo + Ankara ATP + Sezon).
 * Arama / kategori filtresi / kolon sort / CSV export.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Download, ArrowUpDown } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { rowsToCsv, downloadCsv } from '@/lib/wms/exportCsv';

const logger = createLogger('StokHaritasi');

interface Row {
  iwasku: string;
  name: string | null;
  category: string | null;
  desi: number | null;
  shukranCg: number; mdnCg: number;
  nj: number; showroom: number;
  ankaraAtp: number; sezon: number;
  fbaUs: number; fbaUk: number; fbaEu: number; fbaCa: number; fbaAu: number; fbaAe: number; fbaSa: number;
  total: number;
}

type SortKey = keyof Pick<Row, 'iwasku' | 'name' | 'category' | 'desi' | 'shukranCg' | 'mdnCg' | 'nj' | 'showroom' | 'ankaraAtp' | 'sezon' | 'fbaUs' | 'fbaUk' | 'fbaEu' | 'fbaCa' | 'fbaAu' | 'fbaAe' | 'fbaSa' | 'total'>;

// Kolon tanımı: key, başlık, sayısal mı, grup (renk)
const COLS: { key: SortKey; label: string; group?: 'cg' | 'us' | 'ankara' | 'fba' }[] = [
  { key: 'shukranCg', label: 'Shukran CG', group: 'cg' },
  { key: 'mdnCg', label: 'MDN CG', group: 'cg' },
  { key: 'showroom', label: 'Fairfield', group: 'us' },
  { key: 'nj', label: 'Somerset', group: 'us' },
  { key: 'ankaraAtp', label: 'Ankara ATP', group: 'ankara' },
  { key: 'sezon', label: 'Sezon', group: 'ankara' },
  { key: 'fbaUs', label: 'FBA US', group: 'fba' },
  { key: 'fbaUk', label: 'FBA UK', group: 'fba' },
  { key: 'fbaEu', label: 'FBA EU', group: 'fba' },
  { key: 'fbaCa', label: 'FBA CA', group: 'fba' },
  { key: 'fbaAu', label: 'FBA AU', group: 'fba' },
  { key: 'fbaAe', label: 'FBA AE', group: 'fba' },
  { key: 'fbaSa', label: 'FBA SA', group: 'fba' },
];

const GROUP_BG: Record<string, string> = {
  cg: 'bg-amber-50/60', us: 'bg-emerald-50/60', ankara: 'bg-violet-50/60', fba: 'bg-sky-50/40',
};

export default function StokHaritasiPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/stok-haritasi', { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Yüklenemedi');
      setRows(json.data.rows as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hata');
      logger.error('load', e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = rows.filter((r) =>
      (cat === 'ALL' || r.category === cat) &&
      (!term || r.iwasku.toLowerCase().includes(term) || (r.name ?? '').toLowerCase().includes(term)),
    );
    list = [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'tr');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, q, cat, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'iwasku' || k === 'name' || k === 'category' ? 'asc' : 'desc'); }
  };

  const exportCsv = () => {
    const headers = ['iwasku', 'Ürün', 'Kategori', 'Desi', ...COLS.map((c) => c.label), 'Toplam'];
    const body = filtered.map((r) => [
      r.iwasku, r.name ?? '', r.category ?? '', r.desi ?? '',
      ...COLS.map((c) => r[c.key] as number), r.total,
    ]);
    downloadCsv(rowsToCsv(headers, body), 'stok-haritasi.csv');
  };

  const num = (v: number) => (v > 0 ? <span className="text-gray-800">{v}</span> : <span className="text-gray-300">0</span>);

  return (
    <div className="p-4 md:p-6 max-w-[1700px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stok Haritası</h1>
          <p className="text-sm text-gray-500 mt-0.5">iwasku bazında tüm lokasyon stoğu · CG (Shukran/MDN) + US depo + Ankara + FBA</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
          <button onClick={exportCsv} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="iwasku / ürün ara…"
            className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 w-64" />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700">
          <option value="ALL">Tüm Kategoriler</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">{filtered.length} ürün</span>
      </div>

      {error && <div className="mb-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                <th className="px-3 py-2.5 cursor-pointer hover:text-gray-800" onClick={() => toggleSort('iwasku')}>Ürün</th>
                <th className="px-3 py-2.5 cursor-pointer hover:text-gray-800" onClick={() => toggleSort('category')}>Kategori</th>
                <th className="px-3 py-2.5 text-right cursor-pointer hover:text-gray-800" onClick={() => toggleSort('desi')}>Desi</th>
                {COLS.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    className={`px-3 py-2.5 text-right cursor-pointer hover:text-gray-800 ${c.group ? GROUP_BG[c.group] : ''}`}>
                    <span className="inline-flex items-center gap-1">{c.label}<ArrowUpDown className="w-3 h-3 opacity-40" /></span>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right cursor-pointer hover:text-gray-800 font-bold" onClick={() => toggleSort('total')}>Toplam</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4 + COLS.length} className="px-3 py-12 text-center text-gray-400">Yükleniyor…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4 + COLS.length} className="px-3 py-12 text-center text-gray-400">Kayıt yok.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.iwasku} className="hover:bg-gray-50/70">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">{r.name ?? r.iwasku}</div>
                    <div className="text-[11px] font-mono text-gray-400">{r.iwasku}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{r.category ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{r.desi != null ? r.desi.toFixed(1) : '—'}</td>
                  {COLS.map((c) => (
                    <td key={c.key} className={`px-3 py-2 text-right ${c.group ? GROUP_BG[c.group] : ''}`}>{num(r[c.key] as number)}</td>
                  ))}
                  <td className="px-3 py-2 text-right font-bold text-gray-900">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
