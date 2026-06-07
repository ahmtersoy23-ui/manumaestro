'use client';

/**
 * Stok Haritası — iwasku bazında tüm lokasyonların ON-HAND stoğu (sadece görüntüleme).
 * Kolon düzeni StockPulse AllStock referanslı (bölge-gruplu): Ürün | Amerika | Türkiye |
 * Avrupa | Kanada | Avustralya | Orta Doğu | Toplam. Fark: CG ikili (Shukran+MDN) ve
 * Türkiye'de İvedik Depo (ATP) yanında ayrı Sezon kolonu.
 * Kaynak: GET /api/stok-haritasi. Arama / kategori / sort / CSV.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, Download, ArrowUpDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
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

const GROUP_META: Record<GroupKey, { label: string; text: string; border: string; bg: string }> = {
  amerika:    { label: 'Amerika',    text: 'text-blue-600',   border: 'border-l border-l-blue-200',   bg: 'bg-blue-50/60' },
  turkiye:    { label: 'Türkiye',    text: 'text-rose-600',   border: 'border-l border-l-rose-200',   bg: 'bg-rose-50/60' },
  avrupa:     { label: 'Avrupa',     text: 'text-violet-600', border: 'border-l border-l-violet-200', bg: 'bg-violet-50/60' },
  kanada:     { label: 'Kanada',     text: 'text-red-600',    border: 'border-l border-l-red-200',    bg: 'bg-red-50/60' },
  avustralya: { label: 'Avustralya', text: 'text-orange-600', border: 'border-l border-l-orange-200', bg: 'bg-orange-50/60' },
  ortadogu:   { label: 'Orta Doğu',  text: 'text-teal-600',   border: 'border-l border-l-teal-200',   bg: 'bg-teal-50/60' },
  total:      { label: '',           text: 'text-gray-700',   border: 'border-l border-l-gray-300',   bg: 'bg-slate-100/80' },
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

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

  // Sayfalama (client-side; veri zaten yüklü) + filtre/sort değişince başa dön
  useEffect(() => { setPage(1); }, [q, cat, sortKey, sortDir, pageSize]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  // Filtrelenmiş set için kolon toplamları (footer)
  const totals = useMemo(() => {
    const t = Object.fromEntries(COLS.map((c) => [c.key, 0])) as Record<NumKey, number>;
    for (const r of filtered) for (const c of COLS) t[c.key] += (r[c.key] as number) || 0;
    return t;
  }, [filtered]);

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

  // Yatay drag-to-scroll: tabloyu mouse'la tutup kaydır. Sürükleme olduysa
  // takip eden click'i yut (yanlışlıkla kolon sort'u tetiklenmesin).
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, startX: 0, left: 0, moved: false });
  const onDragStart = (e: React.MouseEvent) => {
    const el = scrollRef.current; if (!el) return;
    drag.current = { down: true, startX: e.pageX, left: el.scrollLeft, moved: false };
  };
  const onDragMove = (e: React.MouseEvent) => {
    if (!drag.current.down) return;
    const el = scrollRef.current; if (!el) return;
    const dx = e.pageX - drag.current.startX;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    el.scrollLeft = drag.current.left - dx;
    e.preventDefault();
  };
  const onDragEnd = () => { drag.current.down = false; };
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) { e.preventDefault(); e.stopPropagation(); drag.current.moved = false; }
  };

  const nf = (v: number) => v.toLocaleString('tr-TR');
  const num = (v: number) => (v > 0 ? <span className="text-gray-800">{nf(v)}</span> : <span className="text-gray-300">0</span>);
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
            className="pl-8 pr-8 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 w-64 focus:border-gray-400 focus:outline-none" />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" title="Temizle">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
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
        <div
          ref={scrollRef}
          onMouseDown={onDragStart}
          onMouseMove={onDragMove}
          onMouseUp={onDragEnd}
          onMouseLeave={onDragEnd}
          onClickCapture={onClickCapture}
          className="overflow-x-auto cursor-grab active:cursor-grabbing"
        >
          <table className="min-w-full text-sm whitespace-nowrap">
            <thead>
              {/* Bölge bantları */}
              <tr className="bg-gray-50/80 border-b border-gray-200">
                <th colSpan={2} className="sticky left-0 z-30 bg-gray-50 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400 border-r border-gray-200">Ürün</th>
                <th colSpan={2} className="px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">Detay</th>
                {GROUP_RUNS.map((r) => (
                  <th key={r.group} colSpan={r.span}
                    className={`px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest ${GROUP_META[r.group].text} ${GROUP_META[r.group].border}`}>
                    {GROUP_META[r.group].label}
                  </th>
                ))}
              </tr>
              {/* Kolon başlıkları */}
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                <th className="sticky left-0 z-30 bg-gray-50 w-[130px] min-w-[130px] max-w-[130px] px-3 py-3 cursor-pointer hover:text-gray-800" onClick={() => toggleSort('iwasku')}>IWASKU</th>
                <th className="sticky left-[130px] z-30 bg-gray-50 w-[300px] min-w-[300px] max-w-[300px] px-3 py-3 cursor-pointer hover:text-gray-800 border-r border-gray-200" onClick={() => toggleSort('name')}>Ürün Adı</th>
                <th className="px-3 py-3 min-w-[120px] cursor-pointer hover:text-gray-800" onClick={() => toggleSort('category')}>Kategori</th>
                <th className="px-3 py-3 text-right cursor-pointer hover:text-gray-800" onClick={() => toggleSort('desi')}>Desi</th>
                {COLS.map((c, idx) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    className={`px-3 py-3 text-right cursor-pointer hover:text-gray-800 ${GROUP_META[c.group].bg} ${c.key === 'total' ? 'font-bold' : ''} ${groupBorder(idx)}`}>
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
              ) : paged.map((r) => (
                <tr key={r.iwasku} className="group hover:bg-blue-50/40">
                  <td className="sticky left-0 z-20 bg-white group-hover:bg-blue-50 w-[130px] min-w-[130px] max-w-[130px] px-3 py-3.5 align-top font-mono text-xs text-gray-600">{r.iwasku}</td>
                  <td className="sticky left-[130px] z-20 bg-white group-hover:bg-blue-50 w-[300px] min-w-[300px] max-w-[300px] px-3 py-3.5 align-top border-r border-gray-200">
                    <div className="text-xs text-gray-800 leading-snug whitespace-normal break-words">{r.name ?? '—'}</div>
                  </td>
                  <td className="px-3 py-3.5 align-top text-gray-600 text-xs min-w-[120px]">{r.category ?? '—'}</td>
                  <td className="px-3 py-3.5 align-top text-right text-gray-600 text-sm">{r.desi != null ? r.desi.toFixed(1) : '—'}</td>
                  {COLS.map((c, idx) => (
                    <td key={c.key} className={`px-3 py-3.5 align-top text-right text-sm ${GROUP_META[c.group].bg} ${c.key === 'total' ? 'font-bold text-gray-900' : ''} ${groupBorder(idx)}`}>
                      {c.key === 'total' ? nf(r.total) : num(r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold text-gray-700">
                  <td className="sticky left-0 z-20 bg-gray-50 px-3 py-3 text-xs uppercase tracking-wide border-r border-gray-200" colSpan={2}>Toplam ({nf(filtered.length)} ürün)</td>
                  <td className="px-3 py-3" colSpan={2}></td>
                  {COLS.map((c, idx) => (
                    <td key={c.key} className={`px-3 py-3 text-right text-sm ${GROUP_META[c.group].bg} ${c.key === 'total' ? 'font-bold text-gray-900' : ''} ${groupBorder(idx)}`}>
                      {nf(totals[c.key])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Sayfalama */}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <span>Sayfa başı</span>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
              className="px-2 py-1 rounded-lg border border-gray-200 bg-white text-gray-700">
              {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="text-gray-400">
              {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} / {nf(filtered.length)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
              className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-gray-600">{safePage} / {pageCount}</span>
            <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount}
              className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
