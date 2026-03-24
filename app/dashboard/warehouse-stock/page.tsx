/**
 * Warehouse Stock Page
 * Manage warehouse (İvedik depo) stock levels
 * - Initial stock entry per product per month
 * - Weekly stock arrival entries
 * - Excel/CSV bulk import
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Warehouse, Upload, Search, Plus, Trash2, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { formatMonthValue, formatMonthDisplay } from '@/lib/monthUtils';
import { createLogger } from '@/lib/logger';
import * as XLSX from 'xlsx';

const logger = createLogger('WarehouseStockPage');

interface StockEntry {
  id: string;
  iwasku: string;
  quantity: number;
  month: string;
  weekLabel: string | null;
  productName: string;
  productCategory: string;
  desi: number | null;
}

interface ProductSearchResult {
  product_sku: string;
  name: string;
  category: string;
  size: number | null;
}

function getWeekLabelsForMonth(month: string): string[] {
  const [year, m] = month.split('-').map(Number);
  const start = new Date(year, m - 1, 1);
  const end = new Date(year, m, 0); // last day
  const weeks: string[] = [];

  const current = new Date(start);
  while (current <= end) {
    const weekStart = new Date(current);
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (weekEnd > end) weekEnd.setTime(end.getTime());

    const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('tr-TR', { month: 'short' })}`;
    weeks.push(`${fmt(weekStart)}-${fmt(weekEnd)} ${year.toString().slice(2)}`);

    current.setDate(current.getDate() + 7);
  }

  return weeks;
}

export default function WarehouseStockPage() {
  const { role } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [month, setMonth] = useState(formatMonthValue(new Date()));
  const [entries, setEntries] = useState<StockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  // Search & add state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [newQuantity, setNewQuantity] = useState(0);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; warnings: string[] } | null>(null);

  const weekLabels = getWeekLabelsForMonth(month);

  // Check permissions
  useEffect(() => {
    async function checkPerm() {
      if (role === 'admin') { setCanEdit(true); return; }
      try {
        // Permission check happens via API — if 403, no edit access
        const res = await fetch(`/api/admin/warehouse-stock?month=${month}`);
        if (res.ok) setCanEdit(true);
      } catch { /* no access */ }
    }
    checkPerm();
  }, [role, month]);

  // Fetch stock data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/warehouse-stock?month=${month}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) setEntries(data.data);
      }
    } catch (err) {
      logger.error('Failed to fetch stock data:', err);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Search products
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        if (data.success) setSearchResults(data.data);
      } catch (err) {
        logger.error('Product search failed:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Add stock entry
  const addEntry = async (product: ProductSearchResult) => {
    if (newQuantity <= 0) return;
    try {
      const res = await fetch('/api/admin/warehouse-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iwasku: product.product_sku,
          quantity: newQuantity,
          month,
          weekLabel: selectedWeek,
        }),
      });
      if (res.ok) {
        setSearchQuery('');
        setSearchResults([]);
        setNewQuantity(0);
        fetchData();
      }
    } catch (err) {
      logger.error('Failed to add stock entry:', err);
    }
  };

  // Delete entry
  const deleteEntry = async (id: string) => {
    try {
      await fetch('/api/admin/warehouse-stock', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      fetchData();
    } catch (err) {
      logger.error('Failed to delete stock entry:', err);
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

      // Detect columns: first col = iwasku, second = quantity
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
        body: JSON.stringify({ month, weekLabel: selectedWeek, items }),
      });

      const data = await res.json();
      if (data.success) {
        setImportResult(data.data);
        fetchData();
      } else {
        setImportResult({ imported: 0, warnings: [data.error || 'Import başarısız'] });
      }
    } catch (err) {
      logger.error('Import failed:', err);
      setImportResult({ imported: 0, warnings: ['Dosya okunamadı'] });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Group entries: initial vs weekly
  const initialEntries = entries.filter(e => e.weekLabel === null);
  const weeklyEntries = entries.filter(e => e.weekLabel !== null);

  // Month options
  const monthOptions = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() + i - 2);
    const val = formatMonthValue(d);
    return { value: val, label: formatMonthDisplay(val) };
  });

  // Category summary
  const categoryTotals = new Map<string, { count: number; totalQty: number; totalDesi: number }>();
  initialEntries.forEach(e => {
    const cat = e.productCategory || 'Diğer';
    const prev = categoryTotals.get(cat) || { count: 0, totalQty: 0, totalDesi: 0 };
    categoryTotals.set(cat, {
      count: prev.count + 1,
      totalQty: prev.totalQty + e.quantity,
      totalDesi: prev.totalDesi + (e.desi ? e.desi * e.quantity : 0),
    });
  });

  return (
    <div className="space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Panele Dön
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Warehouse className="w-6 h-6 md:w-8 md:h-8 text-emerald-600" />
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Depo Stoğu</h1>
          </div>
          <p className="text-sm text-gray-600">İvedik depo stok durumunu yönetin</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {monthOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Category Summary */}
      {categoryTotals.size > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...categoryTotals.entries()].map(([cat, stats]) => (
            <div key={cat} className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-500 truncate">{cat}</p>
              <p className="text-lg font-bold text-gray-900">{stats.totalQty.toLocaleString()}</p>
              <p className="text-xs text-gray-400">{stats.count} ürün · {Math.round(stats.totalDesi)} desi</p>
            </div>
          ))}
        </div>
      )}

      {/* Add Entry / Import */}
      {canEdit && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Week selector */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Giriş Tipi</label>
              <select
                value={selectedWeek ?? ''}
                onChange={e => setSelectedWeek(e.target.value || null)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-full md:w-auto"
              >
                <option value="">Başlangıç Stoğu</option>
                {weekLabels.map(w => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>

            {/* Product search */}
            <div className="flex-1 relative">
              <label className="block text-xs font-medium text-gray-600 mb-1">Ürün Ara (IWASKU veya isim)</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="IWASKU veya ürün adı..."
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              {searchResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                  {searchResults.map(p => (
                    <button
                      key={p.product_sku}
                      onClick={() => addEntry(p)}
                      className="w-full text-left px-4 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      <p className="text-sm font-medium text-blue-600">{p.product_sku}</p>
                      <p className="text-xs text-gray-600 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.category} · {p.size || '?'} desi</p>
                    </button>
                  ))}
                </div>
              )}
              {searching && <p className="absolute mt-1 text-xs text-gray-400">Aranıyor...</p>}
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Miktar</label>
              <input
                type="number"
                value={newQuantity || ''}
                onChange={e => setNewQuantity(parseInt(e.target.value) || 0)}
                min={0}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="0"
              />
            </div>
          </div>

          {/* Import */}
          <div className="flex items-center gap-3 pt-3 border-t border-gray-200">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImport}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {importing ? 'İçe aktarılıyor...' : 'Excel / CSV İçe Aktar'}
            </button>
            <p className="text-xs text-gray-400">A: IWASKU, B: Miktar</p>
          </div>

          {importResult && (
            <div className={`p-3 rounded-lg text-sm ${importResult.warnings.length > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
              <p className="font-medium">{importResult.imported} ürün içe aktarıldı</p>
              {importResult.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700 mt-1">⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stock Table - Initial */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 md:px-6 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-900">Başlangıç Stoğu ({initialEntries.length} ürün)</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Yükleniyor...</div>
        ) : initialEntries.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Bu ay için başlangıç stoğu girilmemiş</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">IWASKU</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Ürün</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Kategori</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Miktar</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Desi</th>
                  {canEdit && <th className="px-4 py-2 w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {initialEntries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm font-mono text-blue-600">{e.iwasku}</td>
                    <td className="px-4 py-2 text-sm text-gray-900 max-w-xs truncate">{e.productName}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{e.productCategory}</td>
                    <td className="px-4 py-2 text-sm text-right font-medium">{e.quantity}</td>
                    <td className="px-4 py-2 text-sm text-right text-gray-500">{e.desi || '-'}</td>
                    {canEdit && (
                      <td className="px-4 py-2 text-center">
                        <button onClick={() => deleteEntry(e.id)} className="text-gray-400 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Weekly Entries */}
      {weeklyEntries.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 md:px-6 py-3 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900">Haftalık Girişler ({weeklyEntries.length})</h2>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Hafta</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">IWASKU</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Ürün</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Miktar</th>
                  {canEdit && <th className="px-4 py-2 w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {weeklyEntries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{e.weekLabel}</td>
                    <td className="px-4 py-2 text-sm font-mono text-blue-600">{e.iwasku}</td>
                    <td className="px-4 py-2 text-sm text-gray-900 max-w-xs truncate">{e.productName}</td>
                    <td className="px-4 py-2 text-sm text-right font-medium">{e.quantity}</td>
                    {canEdit && (
                      <td className="px-4 py-2 text-center">
                        <button onClick={() => deleteEntry(e.id)} className="text-gray-400 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
