/**
 * Warehouse Stock Page — Spreadsheet-style inventory management
 * Continuous inventory (not monthly). Snapshot'lar ayrı tab'da.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Warehouse, Upload, Search, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';
import * as XLSX from 'xlsx';

const logger = createLogger('WarehouseStockPage');

interface WeeklyEntry {
  id: string;
  weekStart: string;
  quantity: number;
}

interface StockProduct {
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  desi: number | null;
  eskiStok: number;
  ilaveStok: number;
  cikis: number;
  uretilen: number;
  mevcut: number;
  toplamDesi: number | null;
  weeklyEntries: WeeklyEntry[];
}

// Generate week starts (Mondays) for a date range
function getWeekStarts(weeksBack: number = 12): string[] {
  const weeks: string[] = [];
  const today = new Date();
  // Find this Monday
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  for (let i = -weeksBack; i <= 0; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i * 7);
    weeks.push(d.toISOString().split('T')[0]);
  }
  return weeks;
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const endD = new Date(d);
  endD.setDate(d.getDate() + 6);
  const fmt = (dt: Date) => `${dt.getDate()}.${dt.getMonth() + 1}`;
  return `${fmt(d)}-${fmt(endD)}`;
}

export default function WarehouseStockPage() {
  const { role } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState<StockProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; warnings: string[] } | null>(null);

  // Add product state
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<{ product_sku: string; name: string; category: string; size: number | null }[]>([]);
  const [addQty, setAddQty] = useState(0);

  const weekStarts = getWeekStarts(12);

  useEffect(() => {
    setCanEdit(role === 'admin' || role === 'editor');
  }, [role]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/warehouse-stock');
      if (res.ok) {
        const data = await res.json();
        if (data.success) setProducts(data.data);
      }
    } catch (err) {
      logger.error('Failed to fetch stock data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Search for adding new product
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

  // Update product field (eskiStok, ilaveStok, cikis)
  const updateField = async (iwasku: string, field: 'eskiStok' | 'ilaveStok' | 'cikis', value: number) => {
    setSaving(`${iwasku}-${field}`);
    try {
      await fetch('/api/admin/warehouse-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iwasku, field, value }),
      });
      // Optimistic update
      setProducts(prev => prev.map(p => {
        if (p.iwasku !== iwasku) return p;
        const updated = { ...p, [field]: value };
        updated.mevcut = updated.eskiStok + updated.uretilen + updated.ilaveStok - updated.cikis;
        updated.toplamDesi = updated.desi ? Math.round(updated.mevcut * updated.desi * 100) / 100 : null;
        return updated;
      }));
    } catch (err) {
      logger.error('Update failed:', err);
    } finally {
      setSaving(null);
    }
  };

  // Update weekly entry
  const updateWeekly = async (iwasku: string, weekStart: string, quantity: number) => {
    setSaving(`${iwasku}-${weekStart}`);
    try {
      await fetch('/api/admin/warehouse-stock/weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iwasku, weekStart, quantity }),
      });
      // Optimistic update
      setProducts(prev => prev.map(p => {
        if (p.iwasku !== iwasku) return p;
        const entries = [...p.weeklyEntries];
        const idx = entries.findIndex(e => e.weekStart.startsWith(weekStart));
        if (quantity === 0) {
          if (idx >= 0) entries.splice(idx, 1);
        } else if (idx >= 0) {
          entries[idx] = { ...entries[idx], quantity };
        } else {
          entries.push({ id: 'temp', weekStart, quantity });
        }
        const uretilen = entries.reduce((sum, e) => sum + e.quantity, 0);
        const mevcut = p.eskiStok + uretilen + p.ilaveStok - p.cikis;
        return {
          ...p,
          weeklyEntries: entries,
          uretilen,
          mevcut,
          toplamDesi: p.desi ? Math.round(mevcut * p.desi * 100) / 100 : null,
        };
      }));
    } catch (err) {
      logger.error('Weekly update failed:', err);
    } finally {
      setSaving(null);
    }
  };

  // Add new product
  const addProduct = async (sku: string) => {
    if (addQty <= 0) return;
    try {
      await fetch('/api/admin/warehouse-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iwasku: sku, field: 'eskiStok', value: addQty }),
      });
      setAddQuery('');
      setAddResults([]);
      setAddQty(0);
      fetchData();
    } catch (err) {
      logger.error('Add product failed:', err);
    }
  };

  // Excel import
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const items = rows
        .map(row => {
          const values = Object.values(row);
          const iwasku = String(values[0] || '').trim();
          const qty = parseInt(String(values[1] || '0').replace(/[.,]/g, ''), 10);
          return { iwasku, quantity: isNaN(qty) ? 0 : qty };
        })
        .filter(item => item.iwasku && item.quantity > 0);
      if (items.length === 0) {
        setImportResult({ imported: 0, warnings: ['Geçerli veri bulunamadı'] });
        return;
      }
      const res = await fetch('/api/admin/warehouse-stock/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (data.success) {
        setImportResult(data.data);
        fetchData();
      }
    } catch (err) {
      logger.error('Import failed:', err);
      setImportResult({ imported: 0, warnings: ['Dosya okunamadı'] });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Filters
  const categories = [...new Set(products.map(p => p.productCategory).filter(Boolean))].sort();
  const filtered = products.filter(p => {
    if (searchFilter && !p.iwasku.toLowerCase().includes(searchFilter.toLowerCase()) && !p.productName.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    if (categoryFilter && p.productCategory !== categoryFilter) return false;
    return true;
  });

  // Editable cell component
  const EditableCell = ({ value, onSave, disabled, className = '' }: {
    value: number; onSave: (v: number) => void; disabled?: boolean; className?: string;
  }) => {
    const [editing, setEditing] = useState(false);
    const [localVal, setLocalVal] = useState(String(value));
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { setLocalVal(String(value)); }, [value]);
    useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

    if (!canEdit || disabled) {
      return <span className={className}>{value || '-'}</span>;
    }

    if (editing) {
      return (
        <input
          ref={inputRef}
          type="number"
          value={localVal}
          onChange={e => setLocalVal(e.target.value)}
          onBlur={() => {
            setEditing(false);
            const v = parseInt(localVal) || 0;
            if (v !== value) onSave(v);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { setLocalVal(String(value)); setEditing(false); }
          }}
          className="w-16 px-1 py-0.5 text-xs text-right border border-purple-400 rounded bg-white focus:outline-none"
        />
      );
    }

    return (
      <span
        onClick={() => setEditing(true)}
        className={`cursor-pointer hover:bg-purple-50 px-1 py-0.5 rounded ${className}`}
      >
        {value || '-'}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Panele Dön
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
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              placeholder="SKU veya ürün ara..."
              className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs w-48"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
          >
            <option value="">Tüm Kategoriler</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Add product + Import */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 bg-white rounded-lg border border-gray-200 p-3">
          <div className="relative flex-1 min-w-48">
            <Plus className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={addQuery}
              onChange={e => setAddQuery(e.target.value)}
              placeholder="Yeni ürün ekle (IWASKU ara)..."
              className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs"
            />
            {addResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                {addResults.filter(r => !products.some(p => p.iwasku === r.product_sku)).map(p => (
                  <button
                    key={p.product_sku}
                    onClick={() => addProduct(p.product_sku)}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  >
                    <span className="text-xs font-mono text-blue-600">{p.product_sku}</span>
                    <span className="text-xs text-gray-500 ml-2">{p.name?.slice(0, 40)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            type="number"
            value={addQty || ''}
            onChange={e => setAddQty(parseInt(e.target.value) || 0)}
            placeholder="Miktar"
            className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
          />
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {importing ? 'İçe aktarılıyor...' : 'Excel İçe Aktar'}
          </button>
        </div>
      )}

      {importResult && (
        <div className={`p-2 rounded-lg text-xs ${importResult.warnings.length > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
          <span className="font-medium">{importResult.imported} ürün aktarıldı</span>
          {importResult.warnings.slice(0, 5).map((w, i) => <span key={i} className="block text-amber-700">⚠ {w}</span>)}
          {importResult.warnings.length > 5 && <span className="block text-amber-700">... ve {importResult.warnings.length - 5} uyarı daha</span>}
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
                  <th className="px-2 py-2 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-20 min-w-[120px]">IWASKU</th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-700 min-w-[200px]">Ürün</th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-500 min-w-[80px]">Kategori</th>
                  <th className="px-2 py-2 text-right font-semibold text-gray-500 min-w-[45px]">Desi</th>
                  <th className="px-2 py-2 text-right font-semibold text-amber-700 bg-amber-50 min-w-[60px]">Eski Stok</th>
                  {weekStarts.map(ws => (
                    <th key={ws} className="px-1 py-2 text-center font-medium text-blue-600 bg-blue-50/50 min-w-[50px] whitespace-nowrap">
                      {formatWeekLabel(ws)}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-semibold text-blue-700 bg-blue-50 min-w-[55px]">Üretilen</th>
                  <th className="px-2 py-2 text-right font-semibold text-green-700 bg-green-50 min-w-[55px]">İlave</th>
                  <th className="px-2 py-2 text-right font-semibold text-red-700 bg-red-50 min-w-[55px]">Çıkış</th>
                  <th className="px-2 py-2 text-right font-bold text-purple-700 bg-purple-50 min-w-[60px]">Mevcut</th>
                  <th className="px-2 py-2 text-right font-semibold text-gray-500 min-w-[65px]">T.Desi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const weekMap = new Map(p.weeklyEntries.map(e => [e.weekStart.split('T')[0], e.quantity]));
                  const isSaving = saving?.startsWith(p.iwasku);

                  return (
                    <tr key={p.iwasku} className={`border-b border-gray-100 hover:bg-gray-50 ${isSaving ? 'opacity-60' : ''}`}>
                      <td className="px-2 py-1.5 font-mono text-blue-600 sticky left-0 bg-white z-10">{p.iwasku}</td>
                      <td className="px-2 py-1.5 text-gray-900 truncate max-w-[200px]" title={p.productName}>{p.productName}</td>
                      <td className="px-2 py-1.5 text-gray-500">{p.productCategory}</td>
                      <td className="px-2 py-1.5 text-right text-gray-400">{p.desi || '-'}</td>
                      <td className="px-2 py-1.5 text-right bg-amber-50/30">
                        <EditableCell value={p.eskiStok} onSave={v => updateField(p.iwasku, 'eskiStok', v)} className="text-amber-700 font-medium" />
                      </td>
                      {weekStarts.map(ws => (
                        <td key={ws} className="px-1 py-1.5 text-center bg-blue-50/10">
                          <EditableCell
                            value={weekMap.get(ws) || 0}
                            onSave={v => updateWeekly(p.iwasku, ws, v)}
                            className="text-blue-600"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-medium text-blue-700 bg-blue-50/30">{p.uretilen || '-'}</td>
                      <td className="px-2 py-1.5 text-right bg-green-50/30">
                        <EditableCell value={p.ilaveStok} onSave={v => updateField(p.iwasku, 'ilaveStok', v)} className="text-green-700" />
                      </td>
                      <td className="px-2 py-1.5 text-right bg-red-50/30">
                        <EditableCell value={p.cikis} onSave={v => updateField(p.iwasku, 'cikis', v)} className="text-red-700" />
                      </td>
                      <td className="px-2 py-1.5 text-right font-bold text-purple-700 bg-purple-50/30">{p.mevcut}</td>
                      <td className="px-2 py-1.5 text-right text-gray-400">{p.toplamDesi ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">{filtered.length} / {products.length} ürün gösteriliyor · Hücrelere tıklayarak düzenleyin</p>
    </div>
  );
}
