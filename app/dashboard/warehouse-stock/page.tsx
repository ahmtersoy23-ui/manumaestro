/**
 * Warehouse Stock Page — Spreadsheet-style inventory management
 * Tabs: Envanter (live inventory) | Aylık Snapshot'lar
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Warehouse, Upload, Search, Plus, Download, ChevronDown, ChevronUp, Camera, ArrowUpDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';
import * as XLSX from 'xlsx';

const logger = createLogger('WarehouseStockPage');

interface WeeklyEntry { id: string; weekStart: string; quantity: number; }
interface StockProduct {
  id: string; iwasku: string; productName: string; productCategory: string;
  desi: number | null; eskiStok: number; ilaveStok: number; cikis: number;
  uretilen: number; mevcut: number; toplamDesi: number | null;
  weeklyEntries: WeeklyEntry[];
}
interface SnapshotItem {
  iwasku: string; productName: string; productCategory: string;
  totalRequested: number; warehouseStock: number; netProduction: number;
}

// Pzt-Cum week starts (4 weeks: prev 2, current, next 1)
function getWeekStarts(): string[] {
  const weeks: string[] = [];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  for (let i = -2; i <= 1; i++) {
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

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const fri = new Date(d);
  fri.setDate(d.getDate() + 4);
  const fmt = (dt: Date) => `${dt.getDate()}`;
  const monthShort = d.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', '');
  return `${fmt(d)}-${fmt(fri)} ${monthShort}`;
}

type SortKey = 'iwasku' | 'productName' | 'productCategory' | 'desi' | 'eskiStok' | 'uretilen' | 'ilaveStok' | 'cikis' | 'mevcut' | 'toplamDesi';

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
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; warnings: string[] } | null>(null);

  // Add product
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<{ product_sku: string; name: string; category: string; size: number | null }[]>([]);

  // Snapshot state
  const [snapshotMonth, setSnapshotMonth] = useState('');
  const [snapshotData, setSnapshotData] = useState<{ summary: { totalRequested: number; totalStock: number; totalNet: number }; snapshots: SnapshotItem[] } | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const weekStarts = getWeekStarts();
  const currentWeek = getCurrentWeekStart();
  const prevWeek = weekStarts.length >= 3 ? weekStarts[1] : '';

  useEffect(() => { setCanEdit(role === 'admin' || role === 'editor'); }, [role]);

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
        updated.mevcut = updated.eskiStok + updated.uretilen + updated.ilaveStok - updated.cikis;
        updated.toplamDesi = updated.desi ? Math.round(updated.mevcut * updated.desi * 100) / 100 : null;
        return updated;
      }));
    } catch (err) { logger.error('Update failed:', err); }
    finally { setSaving(null); }
  };

  // Update weekly
  const updateWeekly = async (iwasku: string, weekStart: string, quantity: number) => {
    setSaving(`${iwasku}-${weekStart}`);
    try {
      await fetch('/api/admin/warehouse-stock/weekly', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iwasku, weekStart, quantity }),
      });
      setProducts(prev => prev.map(p => {
        if (p.iwasku !== iwasku) return p;
        const entries = [...p.weeklyEntries];
        const idx = entries.findIndex(e => e.weekStart.startsWith(weekStart));
        if (quantity === 0 && idx >= 0) entries.splice(idx, 1);
        else if (quantity > 0 && idx >= 0) entries[idx] = { ...entries[idx], quantity };
        else if (quantity > 0) entries.push({ id: 'temp', weekStart, quantity });
        const uretilen = entries.reduce((sum, e) => sum + e.quantity, 0);
        const mevcut = p.eskiStok + uretilen + p.ilaveStok - p.cikis;
        return { ...p, weeklyEntries: entries, uretilen, mevcut, toplamDesi: p.desi ? Math.round(mevcut * p.desi * 100) / 100 : null };
      }));
    } catch (err) { logger.error('Weekly update failed:', err); }
    finally { setSaving(null); }
  };

  // Add product (no quantity, just add to list)
  const addProduct = async (sku: string) => {
    try {
      await fetch('/api/admin/warehouse-stock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iwasku: sku, field: 'eskiStok', value: 0 }),
      });
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
  const handleExport = () => {
    const rows = products.map(p => {
      const row: Record<string, unknown> = {
        IWASKU: p.iwasku, 'Ürün Adı': p.productName, Kategori: p.productCategory,
        Desi: p.desi, 'Eski Stok': p.eskiStok,
      };
      p.weeklyEntries.forEach(w => { row[w.weekStart.split('T')[0]] = w.quantity; });
      row['Üretilen'] = p.uretilen; row['İlave'] = p.ilaveStok;
      row['Çıkış'] = p.cikis; row['Mevcut'] = p.mevcut; row['Toplam Desi'] = p.toplamDesi;
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Depo Stoğu');
    XLSX.writeFile(wb, `depo-stogu-${new Date().toISOString().split('T')[0]}.xlsx`);
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

  // Snapshot month options
  const snapshotMonths = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  });

  // Editable cell
  const EditableCell = ({ value, onSave, editable = true, className = '' }: {
    value: number; onSave: (v: number) => void; editable?: boolean; className?: string;
  }) => {
    const [editing, setEditing] = useState(false);
    const [localVal, setLocalVal] = useState(String(value));
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => { setLocalVal(String(value)); }, [value]);
    useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

    if (!canEdit || !editable) return <span className={className}>{value || '-'}</span>;
    if (editing) {
      return (
        <input ref={inputRef} type="number" value={localVal}
          onChange={e => setLocalVal(e.target.value)}
          onBlur={() => { setEditing(false); const v = parseInt(localVal) || 0; if (v !== value) onSave(v); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setLocalVal(String(value)); setEditing(false); } }}
          className="w-14 px-1 py-0.5 text-xs text-right border border-purple-400 rounded bg-white focus:outline-none"
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
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Panele Dön
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Warehouse className="w-6 h-6 text-emerald-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Depo Stoğu</h1>
            <p className="text-xs text-gray-500">{products.length} ürün · Mevcut: {products.reduce((s, p) => s + p.mevcut, 0).toLocaleString()} adet</p>
          </div>
        </div>
      </div>

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
                      {addResults.filter(r => !products.some(p => p.iwasku === r.product_sku)).map(p => (
                        <button key={p.product_sku} onClick={() => addProduct(p.product_sku)}
                          className="w-full text-left px-3 py-1.5 hover:bg-gray-50 border-b border-gray-100 last:border-0">
                          <span className="text-xs font-mono text-blue-600">{p.product_sku}</span>
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

          {/* Spreadsheet Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm text-gray-400">Yükleniyor...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-auto text-xs border-collapse">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr className="border-b border-gray-200">
                      <SortHeader label="IWASKU" sortField="iwasku" className="text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-20 min-w-[120px]" />
                      <SortHeader label="Ürün Adı" sortField="productName" className="text-left font-semibold text-gray-700 min-w-[250px]" />
                      <SortHeader label="Kategori" sortField="productCategory" className="text-left font-semibold text-gray-500 min-w-[80px] max-w-[120px]" />
                      <SortHeader label="Desi" sortField="desi" className="text-right font-semibold text-gray-500 min-w-[40px]" />
                      <SortHeader label="Eski Stok" sortField="eskiStok" className="text-right font-semibold text-amber-700 bg-amber-50 min-w-[55px]" />
                      {weekStarts.map(ws => (
                        <th key={ws} className="px-0 py-1 text-center bg-blue-50/50 min-w-[38px] w-[38px]">
                          <span className="inline-block text-[9px] font-medium text-blue-600 [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">
                            {formatWeekLabel(ws)}
                          </span>
                        </th>
                      ))}
                      <SortHeader label="Üretilen" sortField="uretilen" className="text-right font-semibold text-blue-700 bg-blue-50 min-w-[50px]" />
                      <SortHeader label="İlave" sortField="ilaveStok" className="text-right font-semibold text-green-700 bg-green-50 min-w-[45px]" />
                      <SortHeader label="Çıkış" sortField="cikis" className="text-right font-semibold text-red-700 bg-red-50 min-w-[45px]" />
                      <SortHeader label="Mevcut" sortField="mevcut" className="text-right font-bold text-purple-700 bg-purple-50 min-w-[55px]" />
                      <SortHeader label="T.Desi" sortField="toplamDesi" className="text-right font-semibold text-gray-500 min-w-[55px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(p => {
                      const weekMap = new Map(p.weeklyEntries.map(e => [e.weekStart.split('T')[0], e.quantity]));
                      const isSaving = saving?.startsWith(p.iwasku);
                      return (
                        <tr key={p.iwasku} className={`border-b border-gray-100 hover:bg-gray-50/70 ${isSaving ? 'opacity-60' : ''}`}>
                          <td className="px-2 py-1 font-mono text-blue-600 text-[11px] sticky left-0 bg-white z-10">{p.iwasku}</td>
                          <td className="px-2 py-1 text-gray-900 min-w-[250px] max-w-[350px]">
                            <span className="line-clamp-2 whitespace-normal leading-tight">{p.productName}</span>
                          </td>
                          <td className="px-2 py-1 text-gray-500 max-w-[120px]">
                            <span className="line-clamp-2 whitespace-normal leading-tight">{p.productCategory}</span>
                          </td>
                          <td className="px-2 py-1 text-right text-gray-400">{p.desi || '-'}</td>
                          <td className="px-2 py-1 text-right bg-amber-50/30">
                            <EditableCell value={p.eskiStok} onSave={v => updateField(p.iwasku, 'eskiStok', v)} className="text-amber-700 font-medium" />
                          </td>
                          {weekStarts.map(ws => {
                            const isEditable = ws === currentWeek || ws === prevWeek;
                            return (
                              <td key={ws} className="px-0.5 py-1 text-center bg-blue-50/10">
                                <EditableCell
                                  value={weekMap.get(ws) || 0}
                                  onSave={v => updateWeekly(p.iwasku, ws, v)}
                                  editable={isEditable}
                                  className={`text-blue-600 ${!isEditable ? 'opacity-50' : ''}`}
                                />
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 text-right font-medium text-blue-700 bg-blue-50/30">{p.uretilen || '-'}</td>
                          <td className="px-2 py-1 text-right bg-green-50/30">
                            <EditableCell value={p.ilaveStok} onSave={v => updateField(p.iwasku, 'ilaveStok', v)} className="text-green-700" />
                          </td>
                          <td className="px-2 py-1 text-right bg-red-50/30">
                            <EditableCell value={p.cikis} onSave={v => updateField(p.iwasku, 'cikis', v)} className="text-red-700" />
                          </td>
                          <td className="px-2 py-1 text-right font-bold text-purple-700 bg-purple-50/30">{p.mevcut}</td>
                          <td className="px-2 py-1 text-right text-gray-400">{p.toplamDesi ?? '-'}</td>
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
            <p className="text-xs text-gray-500">Kilitli aylar için otomatik snapshot oluşturulur</p>
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
    </div>
  );
}
