/**
 * Warehouse Stock View — Ankara depo spreadsheet envanter yönetimi.
 * Hem eski /dashboard/warehouse-stock URL'inde hem yeni /dashboard/depolar/ANKARA
 * Dashboard sekmesinde aynı bileşen render edilir.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Warehouse, Upload, Search, Plus, Download, ChevronDown, ChevronUp, Camera, ArrowUpDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';
// XLSX lazy-loaded at point of use — 500KB not in initial bundle
type XLSX = typeof import('xlsx');
const loadXLSX = () => import('xlsx') as Promise<XLSX>;

const logger = createLogger('WarehouseStockPage');

interface WeeklyEntry { id: string; weekStart: string; quantity: number; }
interface StockProduct {
  id: string; iwasku: string; productName: string; productCategory: string;
  desi: number | null; eskiStok: number; ilaveStok: number; cikis: number;
  uretilen: number; haftalikCikis: number; toplamCikis: number; mevcut: number;
  reserved: number; shipmentReserved: number; liveDemand: number; atp: number;
  toplamDesi: number | null;
  weeklyEntries: WeeklyEntry[];
  shipmentEntries: WeeklyEntry[];
  _seasonPool?: { poolId: string; poolName: string; target: number; produced: number } | null;
  _monthDemands?: { name: string; qty: number }[];
  _seasonDemands?: { code: string; qty: number }[];
}
interface SnapshotItem {
  iwasku: string; productName: string; productCategory: string;
  totalRequested: number; warehouseStock: number; netProduction: number;
}

// Pzt-Cum week starts (2 weeks: prev, current)
function getWeekStarts(): string[] {
  const weeks: string[] = [];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  for (let i = -1; i <= 0; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i * 7);
    weeks.push(d.toISOString().split('T')[0]);
  }
  return weeks;
}

function getCurrentWeekStart(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  return monday.toISOString().split('T')[0];
}

function formatWeekLabel(dateStr: string): { range: string; month: string } {
  const d = new Date(dateStr);
  const fri = new Date(d);
  fri.setDate(d.getDate() + 4);
  const monMonth = d.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', '');
  const friMonth = fri.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', '');
  // Ay geçişi varsa her iki ayı da göster (ör: 30 Mar-3 Nis)
  if (d.getMonth() !== fri.getMonth()) {
    return {
      range: `${d.getDate()} ${monMonth}`,
      month: `${fri.getDate()} ${friMonth}`,
    };
  }
  return {
    range: `${d.getDate()}-${fri.getDate()}`,
    month: monMonth,
  };
}

type SortKey = 'iwasku' | 'productName' | 'productCategory' | 'desi' | 'eskiStok' | 'uretilen' | 'ilaveStok' | 'toplamCikis' | 'mevcut' | 'reserved' | 'shipmentReserved' | 'liveDemand' | 'atp' | 'toplamDesi';

export default function WarehouseStockPage() {
  const { role } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'inventory' | 'snapshots'>('inventory');

  // Inventory state
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('iwasku');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showExtraCols, setShowExtraCols] = useState(false); // Başlangıç + İlave collapsed
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; warnings: string[] } | null>(null);

  // Add product
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<{ iwasku: string; name: string; category: string; size: number | null }[]>([]);

  // Snapshot state
  const [snapshotMonth, setSnapshotMonth] = useState('');
  const [snapshotData, setSnapshotData] = useState<{ summary: { totalRequested: number; totalStock: number; totalNet: number }; snapshots: SnapshotItem[] } | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  // Demand modal — Aylık / SZN Talep detayı
  type DemandModalState = {
    iwasku: string;
    productName: string;
    type: 'monthly' | 'season';
    items: { label: string; qty: number }[];
  };
  const [demandModal, setDemandModal] = useState<DemandModalState | null>(null);

  const weekStarts = getWeekStarts();
  const currentWeek = getCurrentWeekStart();
  const prevWeek = weekStarts[0] || '';

  useEffect(() => { setCanEdit(role === 'admin' || role === 'editor'); }, [role]);

  // Modal ESC kapatma
  useEffect(() => {
    if (!demandModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDemandModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demandModal]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/warehouse-stock');
      if (res.ok) {
        const data = await res.json();
        if (data.success) setProducts(data.data);
      }
    } catch (err) { logger.error('Fetch failed:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Product search for adding
  useEffect(() => {
    if (addQuery.length < 2) { setAddResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(addQuery)}`);
        const data = await res.json();
        if (data.success) setAddResults(data.data);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [addQuery]);

  // Update field
  const updateField = async (iwasku: string, field: 'eskiStok' | 'ilaveStok' | 'cikis', value: number) => {
    setSaving(`${iwasku}-${field}`);
    try {
      await fetch('/api/admin/warehouse-stock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iwasku, field, value }),
      });
      setProducts(prev => prev.map(p => {
        if (p.iwasku !== iwasku) return p;
        const updated = { ...p, [field]: value };
        updated.toplamCikis = updated.cikis + updated.haftalikCikis;
        updated.mevcut = updated.eskiStok + updated.uretilen + updated.ilaveStok - updated.toplamCikis;
        updated.toplamDesi = updated.desi ? Math.round(updated.mevcut * updated.desi * 100) / 100 : null;
        return updated;
      }));
    } catch (err) { logger.error('Update failed:', err); }
    finally { setSaving(null); }
  };

  // Update weekly (production or shipment)
  const updateWeekly = async (iwasku: string, weekStart: string, quantity: number, type: 'PRODUCTION' | 'SHIPMENT' = 'PRODUCTION', poolId?: string) => {
    setSaving(`${iwasku}-${type}-${weekStart}`);
    try {
      await fetch('/api/admin/warehouse-stock/weekly', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iwasku, weekStart, quantity, type, ...(poolId ? { poolId } : {}) }),
      });
      setProducts(prev => prev.map(p => {
        if (p.iwasku !== iwasku) return p;
        const entriesKey = type === 'PRODUCTION' ? 'weeklyEntries' : 'shipmentEntries';
        const entries = [...p[entriesKey]];
        const idx = entries.findIndex(e => e.weekStart.startsWith(weekStart));
        if (quantity === 0 && idx >= 0) entries.splice(idx, 1);
        else if (quantity > 0 && idx >= 0) entries[idx] = { ...entries[idx], quantity };
        else if (quantity > 0) entries.push({ id: 'temp', weekStart, quantity });
        const uretilen = type === 'PRODUCTION' ? entries.reduce((sum, e) => sum + e.quantity, 0) : p.uretilen;
        const haftalikCikis = type === 'SHIPMENT' ? entries.reduce((sum, e) => sum + e.quantity, 0) : p.haftalikCikis;
        const toplamCikis = p.cikis + haftalikCikis;
        const mevcut = p.eskiStok + uretilen + p.ilaveStok - toplamCikis;
        return {
          ...p,
          [entriesKey]: entries,
          uretilen, haftalikCikis, toplamCikis, mevcut,
          toplamDesi: p.desi ? Math.round(mevcut * p.desi * 100) / 100 : null,
        };
      }));
    } catch (err) { logger.error('Weekly update failed:', err); }
    finally { setSaving(null); }
  };

  // Add product (no quantity, just add to list)
  const addProduct = async (sku: string) => {
    try {
      const res = await fetch('/api/admin/warehouse-stock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iwasku: sku, field: 'eskiStok', value: 0 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        logger.error('Add product failed:', res.status, err);
        return;
      }
      setAddQuery(''); setAddResults([]);
      fetchData();
    } catch (err) { logger.error('Add failed:', err); }
  };

  // Excel import
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportResult(null);
    try {
      const XLSX = await loadXLSX();
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const items = rows.map(row => {
        const values = Object.values(row);
        return { iwasku: String(values[0] || '').trim(), quantity: parseInt(String(values[1] || '0').replace(/[.,]/g, ''), 10) || 0 };
      }).filter(item => item.iwasku && item.quantity > 0);
      if (items.length === 0) { setImportResult({ imported: 0, warnings: ['Geçerli veri bulunamadı'] }); return; }
      const res = await fetch('/api/admin/warehouse-stock/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (data.success) { setImportResult(data.data); fetchData(); }
    } catch { setImportResult({ imported: 0, warnings: ['Dosya okunamadı'] }); }
    finally { setImporting(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  // Export all data as Excel
  const handleExport = async () => {
    const rows = filtered.map(p => {
      const row: Record<string, unknown> = {
        IWASKU: p.iwasku, 'Ürün Adı': p.productName, Kategori: p.productCategory,
        Desi: p.desi, 'Başlangıç Stoğu': p.eskiStok,
      };
      p.weeklyEntries.forEach(w => { row[`Üretim ${w.weekStart.split('T')[0]}`] = w.quantity; });
      row['Üretilen'] = p.uretilen; row['İlave'] = p.ilaveStok;
      p.shipmentEntries.forEach(w => { row[`Çıkış ${w.weekStart.split('T')[0]}`] = w.quantity; });
      row['Çıkış'] = p.toplamCikis; row['Mevcut'] = p.mevcut; row['Pazar Rez.'] = p.liveDemand; row['Sezon Rez.'] = p.reserved; row['Sev. Rez.'] = p.shipmentReserved; row['ATP'] = p.atp; row['Toplam Desi'] = p.toplamDesi;
      return row;
    });
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Depo Stoğu');
    const suffix = [categoryFilter, searchFilter].filter(Boolean).join('-').replace(/\s+/g, '_');
    XLSX.writeFile(wb, `depo-stogu-${new Date().toISOString().split('T')[0]}${suffix ? `-${suffix}` : ''}.xlsx`);
  };

  // Fetch snapshot
  const fetchSnapshot = async (month: string) => {
    setSnapshotLoading(true); setSnapshotData(null);
    try {
      const res = await fetch(`/api/month-snapshot?month=${month}`);
      const data = await res.json();
      if (data.success && data.data.snapshots.length > 0) {
        setSnapshotData({ summary: data.data.summary, snapshots: data.data.snapshots });
      }
    } catch (err) { logger.error('Snapshot fetch failed:', err); }
    finally { setSnapshotLoading(false); }
  };

  // Regenerate snapshot (admin only) — POST endpoint zaten upsert yapıyor
  const [regenerating, setRegenerating] = useState(false);
  const regenerateSnapshot = async () => {
    if (!snapshotMonth) return;
    setRegenerating(true);
    try {
      const res = await fetch('/api/month-snapshot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: snapshotMonth }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        logger.error('Regenerate failed:', res.status, err);
        return;
      }
      await fetchSnapshot(snapshotMonth);
    } catch (err) { logger.error('Regenerate failed:', err); }
    finally { setRegenerating(false); }
  };

  // Sorting
  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const categories = [...new Set(products.map(p => p.productCategory).filter(Boolean))].sort();
  const filtered = products
    .filter(p => {
      if (searchFilter && !p.iwasku.toLowerCase().includes(searchFilter.toLowerCase()) && !p.productName.toLowerCase().includes(searchFilter.toLowerCase())) return false;
      if (categoryFilter && p.productCategory !== categoryFilter) return false;
      return true;
    })
    .sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string, 'tr') : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });

  // Snapshot month options: next 2 months + current + last 6
  const snapshotMonths = Array.from({ length: 9 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() + 2 - i);
    const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  });

  // Editable cell — supports "+N" for additive input, plain number for override
  const EditableCell = ({ value, onSave, editable = true, className = '' }: {
    value: number; onSave: (v: number) => void; editable?: boolean; className?: string;
  }) => {
    const [editing, setEditing] = useState(false);
    const [localVal, setLocalVal] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => { if (editing) { setLocalVal(String(value)); inputRef.current?.select(); } }, [editing, value]);

    const commit = () => {
      setEditing(false);
      const raw = localVal.trim();
      if (!raw) return;
      let newVal: number;
      if (raw.startsWith('+')) {
        // Additive: +5 means value + 5
        newVal = value + (parseInt(raw.slice(1)) || 0);
      } else {
        newVal = parseInt(raw) || 0;
      }
      if (newVal < 0) newVal = 0;
      if (newVal !== value) onSave(newVal);
    };

    if (!canEdit || !editable) return <span className={className}>{value || '-'}</span>;
    if (editing) {
      return (
        <input ref={inputRef} type="text" inputMode="numeric" value={localVal}
          onChange={e => setLocalVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setEditing(false); } }}
          placeholder={`+${value ? '' : '0'}`}
          className="w-16 px-1 py-0.5 text-xs text-right border border-purple-400 rounded bg-white focus:outline-none"
        />
      );
    }
    return <span onClick={() => setEditing(true)} className={`cursor-pointer hover:bg-purple-50 px-1 py-0.5 rounded ${className}`}>{value || '-'}</span>;
  };

  // Sortable header
  const SortHeader = ({ label, sortField, className = '' }: { label: string; sortField: SortKey; className?: string }) => (
    <th onClick={() => handleSort(sortField)} className={`px-2 py-2 cursor-pointer hover:bg-gray-100 select-none ${className}`}>
      <div className="flex items-center gap-0.5 justify-inherit">
        <span>{label}</span>
        {sortKey === sortField && <ArrowUpDown className="w-2.5 h-2.5 text-purple-500" />}
      </div>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Warehouse className="w-6 h-6 text-emerald-600" />
          <h1 className="text-2xl font-bold text-gray-900">Depo Stoğu</h1>
        </div>
      </div>

      {/* Category Dashboard */}
      {products.length > 0 && (() => {
        const catStats = new Map<string, { count: number; mevcut: number; desi: number }>();
        products.forEach(p => {
          const cat = p.productCategory || 'Diğer';
          const prev = catStats.get(cat) || { count: 0, mevcut: 0, desi: 0 };
          catStats.set(cat, {
            count: prev.count + 1,
            mevcut: prev.mevcut + p.mevcut,
            desi: prev.desi + (p.toplamDesi ?? 0),
          });
        });
        const sorted = [...catStats.entries()].sort((a, b) => b[1].mevcut - a[1].mevcut);
        const totalCount = products.length;
        const totalMevcut = products.reduce((s, p) => s + p.mevcut, 0);
        const totalDesi = products.reduce((s, p) => s + (p.toplamDesi ?? 0), 0);
        // Sezon reserved toplamı
        const seasonProducts = products.filter(p => p.reserved > 0);
        const seasonCount = seasonProducts.length;
        const seasonReserved = seasonProducts.reduce((s, p) => s + p.reserved, 0);
        const seasonDesi = seasonProducts.reduce((s, p) => s + p.reserved * (p.desi ?? 0), 0);
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            <button
              onClick={() => setCategoryFilter('')}
              className={`text-left rounded-lg border p-2.5 transition-colors ${!categoryFilter ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
            >
              <p className="text-[10px] text-emerald-600 font-semibold">Tüm Kategoriler</p>
              <p className="text-sm font-bold text-gray-900">{totalMevcut.toLocaleString()} <span className="text-[10px] font-normal text-gray-400">adet</span></p>
              <p className="text-[10px] text-gray-400">{totalCount} ürün · {Math.round(totalDesi).toLocaleString()} desi</p>
            </button>
            {sorted.map(([cat, s]) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}
                className={`text-left rounded-lg border p-2.5 transition-colors ${categoryFilter === cat ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
              >
                <p className="text-[10px] text-gray-500 truncate">{cat}</p>
                <p className="text-sm font-bold text-gray-900">{s.mevcut.toLocaleString()} <span className="text-[10px] font-normal text-gray-400">adet</span></p>
                <p className="text-[10px] text-gray-400">{s.count} ürün · {Math.round(s.desi)} desi</p>
              </button>
            ))}
            {seasonCount > 0 && (
              <div className="text-left rounded-lg border border-purple-300 bg-purple-50 p-2.5">
                <p className="text-[10px] text-purple-600 font-semibold">Sezon Rezerve</p>
                <p className="text-sm font-bold text-purple-700">{seasonReserved.toLocaleString()} <span className="text-[10px] font-normal text-purple-400">adet</span></p>
                <p className="text-[10px] text-purple-400">{seasonCount} ürün · {Math.round(seasonDesi).toLocaleString()} desi</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-0">
          <button onClick={() => setActiveTab('inventory')}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'inventory' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            Envanter
          </button>
          <button onClick={() => setActiveTab('snapshots')}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'snapshots' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Camera className="w-3.5 h-3.5 inline mr-1.5" />Aylık Snapshot
          </button>
        </nav>
      </div>

      {/* ========== INVENTORY TAB ========== */}
      {activeTab === 'inventory' && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
              <input type="text" value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
                placeholder="SKU veya ürün ara..." className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs w-52 placeholder:text-gray-400" />
            </div>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className={`px-3 py-1.5 border rounded-lg text-xs ${categoryFilter ? 'border-emerald-400 bg-emerald-50 text-emerald-700 font-medium' : 'border-gray-300 text-gray-600'}`}>
              <option value="">Tüm Kategoriler</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {canEdit && (
              <>
                <div className="relative">
                  <Plus className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
                  <input type="text" value={addQuery} onChange={e => setAddQuery(e.target.value)}
                    placeholder="Yeni ürün ekle..." className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs w-48 placeholder:text-gray-400" />
                  {addResults.length > 0 && (
                    <div className="absolute z-20 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                      {addResults.filter(r => !products.some(p => p.iwasku === r.iwasku)).map(p => (
                        <button key={p.iwasku} onClick={() => addProduct(p.iwasku)}
                          className="w-full text-left px-3 py-1.5 hover:bg-gray-50 border-b border-gray-100 last:border-0">
                          <span className="text-xs font-mono text-blue-600">{p.iwasku}</span>
                          <span className="text-xs text-gray-500 ml-2">{p.name?.slice(0, 50)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" />
                <button onClick={() => fileInputRef.current?.click()} disabled={importing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50">
                  <Upload className="w-3.5 h-3.5" /> {importing ? 'Aktarılıyor...' : 'Excel İçe Aktar'}
                </button>
              </>
            )}

            <button onClick={handleExport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 ml-auto">
              <Download className="w-3.5 h-3.5" /> Excel İndir
            </button>
          </div>

          {importResult && (
            <div className={`p-2 rounded-lg text-xs ${importResult.warnings.length > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
              <span className="font-medium">{importResult.imported} ürün aktarıldı</span>
              {importResult.warnings.slice(0, 5).map((w, i) => <span key={i} className="block text-amber-700">⚠ {w}</span>)}
            </div>
          )}

          {/* Column toggle */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setShowExtraCols(!showExtraCols)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${showExtraCols ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}
            >
              {showExtraCols ? '▼ Başlangıç / İlave gizle' : '▶ Başlangıç / İlave göster'}
            </button>
          </div>

          {/* Spreadsheet Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm text-gray-400">Yükleniyor...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr className="border-b border-gray-200">
                      <SortHeader label="IWASKU" sortField="iwasku" className="text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-20 min-w-[120px]" />
                      <SortHeader label="Ürün Adı" sortField="productName" className="text-left font-semibold text-gray-700 min-w-[250px]" />
                      <SortHeader label="Kategori" sortField="productCategory" className="text-left font-semibold text-gray-500 min-w-[80px] max-w-[120px]" />
                      <SortHeader label="Desi" sortField="desi" className="text-right font-semibold text-gray-500 min-w-[40px]" />
                      {showExtraCols && (
                        <SortHeader label="Başlangıç" sortField="eskiStok" className="text-right font-semibold text-amber-700 bg-amber-50 min-w-[55px]" />
                      )}
                      {weekStarts.map(ws => {
                        const wl = formatWeekLabel(ws);
                        return (
                        <th key={`prod-${ws}`} className="px-2 py-1 text-center bg-emerald-50/50">
                          <div className="text-[10px] font-semibold text-emerald-600 leading-tight">{wl.range}</div>
                          <div className="text-[9px] text-emerald-400">{wl.month}</div>
                        </th>
                        );
                      })}
                      <SortHeader label="Üretilen" sortField="uretilen" className="text-right font-semibold text-emerald-700 bg-emerald-50 min-w-[50px]" />
                      {showExtraCols && (
                        <SortHeader label="İlave" sortField="ilaveStok" className="text-right font-semibold text-blue-700 bg-blue-50 min-w-[45px]" />
                      )}
                      {weekStarts.map(ws => {
                        const wl = formatWeekLabel(ws);
                        return (
                        <th key={`ship-${ws}`} className="px-2 py-1 text-center bg-red-50/50">
                          <div className="text-[10px] font-semibold text-red-600 leading-tight">{wl.range}</div>
                          <div className="text-[9px] text-red-400">{wl.month}</div>
                        </th>
                        );
                      })}
                      <SortHeader label="Çıkış" sortField="toplamCikis" className="text-right font-semibold text-red-700 bg-red-50 min-w-[45px]" />
                      <SortHeader label="Mevcut" sortField="mevcut" className="text-right font-bold text-purple-700 bg-purple-50 min-w-[55px]" />
                      <th className="px-2 py-2 text-right font-semibold text-indigo-600 bg-indigo-50 min-w-[80px]">Aylık Talep</th>
                      <th className="px-2 py-2 text-right font-semibold text-purple-600 bg-purple-50 min-w-[80px]">SZN Talep</th>
                      <SortHeader label="Pazar Rez." sortField="liveDemand" className="text-right font-semibold text-rose-600 bg-rose-50 min-w-[55px]" />
                      <SortHeader label="Sezon Rez." sortField="reserved" className="text-right font-semibold text-orange-600 bg-orange-50 min-w-[55px]" />
                      <SortHeader label="Sev. Rez." sortField="shipmentReserved" className="text-right font-semibold text-blue-600 bg-blue-50 min-w-[55px]" />
                      <SortHeader label="ATP" sortField="atp" className="text-right font-bold text-emerald-700 bg-emerald-50 min-w-[55px]" />
                      <SortHeader label="T.Desi" sortField="toplamDesi" className="text-right font-semibold text-gray-500 min-w-[55px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(p => {
                      const prodMap = new Map(p.weeklyEntries.map(e => [e.weekStart.split('T')[0], e.quantity]));
                      const shipMap = new Map(p.shipmentEntries.map(e => [e.weekStart.split('T')[0], e.quantity]));
                      const isSaving = saving?.startsWith(p.iwasku);
                      return (
                        <tr key={p.iwasku} className={`border-b border-gray-100 hover:bg-gray-50/70 ${isSaving ? 'opacity-60' : ''}`}>
                          <td className="px-2 py-1 font-mono text-blue-600 text-[11px] sticky left-0 bg-white z-10">
                            {p.iwasku}
                            {p._seasonPool && (
                              <span className="ml-1 px-1 py-0.5 bg-purple-100 text-purple-600 text-[9px] font-medium rounded" title={`${p._seasonPool.poolName}: ${p._seasonPool.produced}/${p._seasonPool.target}`}>
                                SZN
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-gray-900 min-w-[250px] max-w-[350px]">
                            <span className="line-clamp-2 whitespace-normal leading-tight">{p.productName}</span>
                          </td>
                          <td className="px-2 py-1 text-gray-500 max-w-[120px]">
                            <span className="line-clamp-2 whitespace-normal leading-tight">{p.productCategory}</span>
                          </td>
                          <td className="px-2 py-1 text-right text-gray-400">{p.desi != null ? Number(p.desi).toFixed(1) : '-'}</td>
                          {showExtraCols && (
                          <td className="px-2 py-1 text-right bg-amber-50/30">
                            <EditableCell value={p.eskiStok} onSave={v => updateField(p.iwasku, 'eskiStok', v)} className="text-amber-700" />
                          </td>
                          )}
                          {/* Üretilen haftalık (yeşil, sezon ürünlerinde mor border) */}
                          {weekStarts.map(ws => (
                            <td key={`prod-${ws}`} className={`px-0.5 py-1 text-center ${p._seasonPool ? 'bg-purple-50/20' : 'bg-emerald-50/10'}`}>
                              <EditableCell
                                value={prodMap.get(ws) || 0}
                                onSave={v => updateWeekly(p.iwasku, ws, v, 'PRODUCTION', p._seasonPool?.poolId)}
                                className={p._seasonPool ? 'text-purple-600' : 'text-emerald-600'}
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1 text-right font-medium text-emerald-700 bg-emerald-50/30">{p.uretilen || '-'}</td>
                          {showExtraCols && (
                          <td className="px-2 py-1 text-right bg-blue-50/30">
                            <EditableCell value={p.ilaveStok} onSave={v => updateField(p.iwasku, 'ilaveStok', v)} className="text-blue-700" />
                          </td>
                          )}
                          {/* Çıkış haftalık (kırmızı) */}
                          {weekStarts.map(ws => (
                            <td key={`ship-${ws}`} className="px-0.5 py-1 text-center bg-red-50/10">
                              <EditableCell
                                value={shipMap.get(ws) || 0}
                                onSave={v => updateWeekly(p.iwasku, ws, v, 'SHIPMENT')}
                                className="text-red-600"
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1 text-right font-medium text-red-700 bg-red-50/30">{p.toplamCikis || '-'}</td>
                          <td className="px-2 py-1 text-right font-bold text-purple-700 bg-purple-50/30">{p.mevcut}</td>
                          <td className="px-1 py-1 text-right bg-indigo-50/20">
                            {(p._monthDemands && p._monthDemands.length > 0) ? (
                              <button
                                type="button"
                                onClick={() => setDemandModal({
                                  iwasku: p.iwasku,
                                  productName: p.productName,
                                  type: 'monthly',
                                  items: [...p._monthDemands!].sort((a, b) => b.qty - a.qty).map(d => ({ label: d.name, qty: d.qty })),
                                })}
                                className="w-full text-right hover:bg-indigo-100 rounded px-1 py-0.5 transition-colors"
                              >
                                <span className="font-semibold text-indigo-700">
                                  {p._monthDemands.reduce((s, d) => s + d.qty, 0).toLocaleString()}
                                </span>
                                <span className="ml-1 text-[10px] text-indigo-400">({p._monthDemands.length})</span>
                              </button>
                            ) : <span className="text-[9px] text-gray-300">—</span>}
                          </td>
                          <td className="px-1 py-1 text-right bg-purple-50/20">
                            {(p._seasonDemands && p._seasonDemands.length > 0) ? (
                              <button
                                type="button"
                                onClick={() => setDemandModal({
                                  iwasku: p.iwasku,
                                  productName: p.productName,
                                  type: 'season',
                                  items: [...p._seasonDemands!].sort((a, b) => b.qty - a.qty).map(d => ({ label: d.code, qty: d.qty })),
                                })}
                                className="w-full text-right hover:bg-purple-100 rounded px-1 py-0.5 transition-colors"
                              >
                                <span className="font-semibold text-purple-700">
                                  {p._seasonDemands.reduce((s, d) => s + d.qty, 0).toLocaleString()}
                                </span>
                                <span className="ml-1 text-[10px] text-purple-400">({p._seasonDemands.length})</span>
                              </button>
                            ) : <span className="text-[9px] text-gray-300">—</span>}
                          </td>
                          <td className="px-2 py-1 text-right text-rose-600 bg-rose-50/30" title="Açık non-Sezon talepler — yola çıkmamış pazaryeri rezervi">{p.liveDemand > 0 ? p.liveDemand : '-'}</td>
                          <td className="px-2 py-1 text-right text-orange-600 bg-orange-50/30">{p.reserved > 0 ? p.reserved : '-'}</td>
                          <td className="px-2 py-1 text-right text-blue-600 bg-blue-50/30" title="Kolilenmiş, henüz sevk edilmemiş">{p.shipmentReserved > 0 ? p.shipmentReserved : '-'}</td>
                          <td className="px-2 py-1 text-right font-bold text-emerald-700 bg-emerald-50/30">{p.atp}</td>
                          <td className="px-2 py-1 text-right text-gray-400">{p.toplamDesi != null ? Math.round(Number(p.toplamDesi)) : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400">{filtered.length} / {products.length} ürün · Hücrelere tıklayarak düzenleyin · Eski haftalar için Excel İndir</p>
        </>
      )}

      {/* ========== SNAPSHOTS TAB ========== */}
      {activeTab === 'snapshots' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select value={snapshotMonth} onChange={e => { setSnapshotMonth(e.target.value); if (e.target.value) fetchSnapshot(e.target.value); }}
              className={`px-3 py-2 border border-gray-300 rounded-lg text-sm ${!snapshotMonth ? 'text-gray-500' : 'text-gray-900'}`}>
              <option value="" className="text-gray-500">Ay seçin...</option>
              {snapshotMonths.map(m => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}</option>)}
            </select>
            {role === 'admin' && snapshotMonth && (
              <button
                onClick={regenerateSnapshot}
                disabled={regenerating || snapshotLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50"
                title="Mevcut canlı stok ve rezervlere göre snapshot'ı yeniden hesapla"
              >
                {regenerating ? 'Üretiliyor...' : '↻ Yeniden Üret'}
              </button>
            )}
            <p className="text-xs text-gray-500">Snapshot alınan aylar için veri görüntülenir</p>
          </div>

          {snapshotLoading && <div className="p-8 text-center text-sm text-gray-400">Yükleniyor...</div>}

          {snapshotData && (
            <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden">
              <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-200">
                <p className="text-sm font-semibold text-gray-900">
                  Talep: {snapshotData.summary.totalRequested.toLocaleString()} · Stok: {snapshotData.summary.totalStock.toLocaleString()} · <span className="text-emerald-700">Net İhtiyaç: {snapshotData.summary.totalNet.toLocaleString()}</span>
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">IWASKU</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Ürün</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Kategori</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-600">Talep</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-600">Stok</th>
                      <th className="px-3 py-2 text-right font-semibold text-emerald-700">Net İhtiyaç</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {snapshotData.snapshots.map(s => (
                      <tr key={s.iwasku} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-mono text-blue-600">{s.iwasku}</td>
                        <td className="px-3 py-1.5 text-gray-900">{s.productName}</td>
                        <td className="px-3 py-1.5 text-gray-500">{s.productCategory}</td>
                        <td className="px-3 py-1.5 text-right">{s.totalRequested}</td>
                        <td className="px-3 py-1.5 text-right text-gray-500">{s.warehouseStock}</td>
                        <td className="px-3 py-1.5 text-right font-bold text-emerald-700">{s.netProduction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {snapshotMonth && !snapshotLoading && !snapshotData && (
            <div className="p-8 text-center text-sm text-gray-400">Bu ay için snapshot verisi yok (ay henüz kilitlenmemiş veya üretim talebi yok)</div>
          )}
        </div>
      )}

      {/* Demand Detail Modal — Aylık / SZN Talep */}
      {demandModal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setDemandModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className={`px-4 py-3 border-b border-gray-200 flex items-start justify-between ${demandModal.type === 'monthly' ? 'bg-indigo-50' : 'bg-purple-50'}`}>
              <div className="min-w-0 flex-1">
                <h3 className={`text-sm font-semibold ${demandModal.type === 'monthly' ? 'text-indigo-700' : 'text-purple-700'}`}>
                  {demandModal.type === 'monthly' ? 'Aylık Talep' : 'Sezon Talep'} Detayı
                </h3>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{demandModal.iwasku}</p>
                <p className="text-xs text-gray-700 line-clamp-1">{demandModal.productName}</p>
              </div>
              <button
                onClick={() => setDemandModal(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2"
                aria-label="Kapat"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-gray-600">{demandModal.type === 'monthly' ? 'Kanal' : 'Sezon Kodu'}</th>
                    <th className="px-4 py-2 text-right font-semibold text-gray-600">Adet</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {demandModal.items.map((d, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900">{d.label}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{d.qty.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`px-4 py-3 border-t border-gray-200 flex items-center justify-between ${demandModal.type === 'monthly' ? 'bg-indigo-50' : 'bg-purple-50'}`}>
              <span className="text-xs font-semibold text-gray-700">Toplam ({demandModal.items.length})</span>
              <span className={`text-sm font-bold ${demandModal.type === 'monthly' ? 'text-indigo-700' : 'text-purple-700'}`}>
                {demandModal.items.reduce((s, d) => s + d.qty, 0).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
