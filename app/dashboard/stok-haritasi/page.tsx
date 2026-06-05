'use client';

/**
 * Stok Haritası — iwasku bazında tüm lokasyonların ON-HAND stoğu (sadece görüntüleme).
 * Kolon düzeni StockPulse AllStock referanslı (bölge-gruplu): Ürün | Amerika | Türkiye |
 * Avrupa | Kanada | Avustralya | Orta Doğu | Toplam. Fark: CG ikili (Shukran+MDN) ve
 * Türkiye'de İvedik Depo (ATP) yanında ayrı Sezon kolonu.
 * Kaynak: GET /api/stok-haritasi. Arama / kategori / sort / CSV.
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

type NumKey = 'shukranCg' | 'mdnCg' | 'nj' | 'showroom' | 'ankaraAtp' | 'sezon' | 'fbaUs' | 'fbaUk' | 'fbaEu' | 'fbaCa' | 'fbaAu' | 'fbaAe' | 'fbaSa' | 'total';
type SortKey = 'iwasku' | 'name' | 'category' | 'desi' | NumKey;
type GroupKey = 'amerika' | 'turkiye' | 'avrupa' | 'kanada' | 'avustralya' | 'ortadogu' | 'total';

// StockPulse sırası; CG Depo → Shukran + MDN, Türkiye → İvedik + Sezon.
const COLS: { key: NumKey; label: string; group: GroupKey }[] = [
  { key: 'fbaUs', label: 'FBA US', group: 'amerika' },
  { key: 'nj', label: 'Somerset Depo', group: 'amerika' },
  { key: 'showroom', label: 'Fairfield Depo', group: 'amerika' },
  { key: 'shukranCg', label: 'Shukran CG', group: 'amerika' },
  { key: 'mdnCg', label: 'MDN CG', group: 'amerika' },
  { key: 'ankaraAtp', label: 'İvedik Depo', group: 'turkiye' },
  { key: 'sezon', label: 'Sezon', group: 'turkiye' },
  { key: 'fbaUk', label: 'FBA UK', group: 'avrupa' },
  { key: 'fbaEu', label: 'FBA EU', group: 'avrupa' },
  { key: 'fbaCa', label: 'FBA CA', group: 'kanada' },
  { key: 'fbaAu', label: 'FBA AU', group: 'avustralya' },
  { key: 'fbaAe', label: 'FBA BAE', group: 'ortadogu' },
  { key: 'fbaSa', label: 'FBA SA', group: 'ortadogu' },
  { key: 'total', label: 'TOPLAM', group: 'total' },
];

const GROUP_META: Record<GroupKey, { label: string; text: string; border: string }> = {
  amerika:    { label: 'Amerika',    text: 'text-blue-600',   border: 'border-l border-l-blue-200' },
  turkiye:    { label: 'Türkiye',    text: 'text-rose-600',   border: 'border-l border-l-rose-200' },
  avrupa:     { label: 'Avrupa',     text: 'text-violet-600', border: 'border-l border-l-violet-200' },
  kanada:     { label: 'Kanada',     text: 'text-red-600',    border: 'border-l border-l-red-200' },
  avustralya: { label: 'Avustralya', text: 'text-orange-600', border: 'border-l border-l-orange-200' },
  ortadogu:   { label: 'Orta Doğu',  text: 'text-teal-600',   border: 'border-l border-l-teal-200' },
  total:      { label: '',           text: 'text-gray-700',   border: 'border-l border-l-gray-300' },
};

// Bölge bantları (band row) — sıralı grup + colSpan
const GROUP_RUNS: { group: GroupKey; span: number }[] = (() => {
  const runs: { group: GroupKey; span: number }[] = [];
  for (const c of COLS) {
    const last = runs[runs.length - 1];
    if (last && last.group === c.group) last.span++;
    else runs.push({ group: c.group, span: 1 });
  }
  return runs;
})();

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
    const list = rows.filter((r) =>
      (cat === 'ALL' || r.category === cat) &&
      (!term || r.iwasku.toLowerCase().includes(term) || (r.name ?? '').toLowerCase().includes(term)),
    );
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'tr');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, q, cat, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'iwasku' || k === 'name' || k === 'category' ? 'asc' : 'desc'); }
  };

  const exportCsv = () => {
    const headers = ['iwasku', 'Ürün Adı', 'Kategori', 'Desi', ...COLS.map((c) => c.label)];
    const body = filtered.map((r) => [
      r.iwasku, r.name ?? '', r.category ?? '', r.desi ?? '',
      ...COLS.map((c) => r[c.key]),
    ]);
    downloadCsv(rowsToCsv(headers, body), 'stok-haritasi.csv');
  };

  const num = (v: number) => (v > 0 ? <span className="text-gray-800">{v}</span> : <span className="text-gray-300">0</span>);
  const groupBorder = (idx: number) => (idx === 0 || COLS[idx].group !== COLS[idx - 1].group ? GROUP_META[COLS[idx].group].border : '');

  return (
    <div className="p-4 md:p-6 max-w-[1700px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stok Haritası</h1>
          <p className="text-sm text-gray-500 mt-0.5">iwasku bazında tüm lokasyon stoğu · CG (Shukran/MDN) + US depo + İvedik + FBA</p>
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
              {/* Bölge bantları */}
              <tr className="bg-gray-50/80 border-b border-gray-200">
                <th colSpan={4} className="px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">Ürün</th>
                {GROUP_RUNS.map((r) => (
                  <th key={r.group} colSpan={r.span}
                    className={`px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest ${GROUP_META[r.group].text} ${GROUP_META[r.group].border}`}>
                    {GROUP_META[r.group].label}
                  </th>
                ))}
              </tr>
              {/* Kolon başlıkları */}
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                <th className="px-3 py-2.5 cursor-pointer hover:text-gray-800" onClick={() => toggleSort('iwasku')}>IWASKU</th>
                <th className="px-3 py-2.5 cursor-pointer hover:text-gray-800 w-[150px]" onClick={() => toggleSort('name')}>Ürün Adı</th>
                <th className="px-3 py-2.5 cursor-pointer hover:text-gray-800" onClick={() => toggleSort('category')}>Kategori</th>
                <th className="px-3 py-2.5 text-right cursor-pointer hover:text-gray-800" onClick={() => toggleSort('desi')}>Desi</th>
                {COLS.map((c, idx) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    className={`px-3 py-2.5 text-right cursor-pointer hover:text-gray-800 ${c.key === 'total' ? 'font-bold' : ''} ${groupBorder(idx)}`}>
                    <span className="inline-flex items-center gap-1">{c.label}<ArrowUpDown className="w-3 h-3 opacity-40" /></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4 + COLS.length} className="px-3 py-12 text-center text-gray-400">Yükleniyor…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4 + COLS.length} className="px-3 py-12 text-center text-gray-400">Kayıt yok.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.iwasku} className="hover:bg-gray-50/70">
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.iwasku}</td>
                  <td className="px-3 py-2 w-[150px] max-w-[150px]"><div className="text-xs text-gray-800 line-clamp-2 leading-tight" title={r.name ?? ''}>{r.name ?? '—'}</div></td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{r.category ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{r.desi != null ? r.desi.toFixed(1) : '—'}</td>
                  {COLS.map((c, idx) => (
                    <td key={c.key} className={`px-3 py-2 text-right ${c.key === 'total' ? 'font-bold text-gray-900' : ''} ${groupBorder(idx)}`}>
                      {c.key === 'total' ? r.total : num(r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
