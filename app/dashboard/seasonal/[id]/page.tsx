/**
 * Stock Pool Detail Page
 * Shows reserves, monthly allocations, import functionality, progress
 * Admin only
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft, Upload, Package, TrendingUp, Truck, AlertCircle,
  Loader2, CheckCircle2, XCircle, BarChart3, Calendar, FileSpreadsheet,
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface Reserve {
  id: string;
  iwasku: string;
  targetQuantity: number;
  targetDesi: number | null;
  producedQuantity: number;
  shippedQuantity: number;
  status: string;
  destination: string | null;
  allocations: { month: string; plannedQty: number; plannedDesi: number | null; actualQty: number }[];
}

interface PoolDetail {
  id: string;
  name: string;
  code: string;
  status: string;
  targetQuarter: string | null;
  totalTargetDesi: number | null;
  totalTargetUnits: number | null;
  notes: string | null;
  reserves: Reserve[];
}

const statusColors: Record<string, string> = {
  PLANNED: 'bg-gray-100 text-gray-600',
  PRODUCING: 'bg-yellow-100 text-yellow-700',
  STOCKED: 'bg-green-100 text-green-700',
  RELEASING: 'bg-blue-100 text-blue-700',
  SHIPPED: 'bg-purple-100 text-purple-700',
  CANCELLED: 'bg-red-100 text-red-600',
};

export default function PoolDetailPage() {
  const { role } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'reserves' | 'allocations'>('reserves');
  const [importing, setImporting] = useState(false);
  const [importJson, setImportJson] = useState('');

  const fetchPool = useCallback(async () => {
    try {
      const res = await fetch(`/api/stock-pools/${id}`);
      const data = await res.json();
      if (data.success) setPool(data.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchPool(); }, [fetchPool]);

  if (role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="text-gray-600">Havuz bulunamadı</p>
        <Link href="/dashboard/seasonal" className="text-purple-600 text-sm mt-2 inline-block">Geri dön</Link>
      </div>
    );
  }

  const totalTarget = pool.reserves.reduce((s, r) => s + r.targetQuantity, 0);
  const totalProduced = pool.reserves.reduce((s, r) => s + r.producedQuantity, 0);
  const totalShipped = pool.reserves.reduce((s, r) => s + r.shippedQuantity, 0);
  const totalDesi = pool.reserves.reduce((s, r) => s + (r.targetDesi ?? 0), 0);
  const prodPct = totalTarget > 0 ? Math.round(totalProduced / totalTarget * 100) : 0;
  const shipPct = totalTarget > 0 ? Math.round(totalShipped / totalTarget * 100) : 0;

  // Monthly allocation summary
  const monthMap = new Map<string, { planned: number; actual: number; desi: number }>();
  for (const r of pool.reserves) {
    for (const a of r.allocations) {
      const m = monthMap.get(a.month) ?? { planned: 0, actual: 0, desi: 0 };
      m.planned += a.plannedQty;
      m.actual += a.actualQty;
      m.desi += a.plannedDesi ?? 0;
      monthMap.set(a.month, m);
    }
  }
  const monthSummary = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const handleImport = async (payload: Record<string, unknown>) => {
    setImporting(true);
    try {
      const res = await fetch(`/api/stock-pools/${id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        alert(`${data.data.reservesCreated} ürün aktarıldı, ${data.data.allocationsCreated} dağılım oluşturuldu`);
        setImportJson('');
        fetchPool();
      } else {
        alert(data.error || 'Aktarım başarısız');
      }
    } catch {
      alert('Aktarım hatası');
    } finally {
      setImporting(false);
    }
  };

  const handleJsonImport = () => {
    if (!importJson.trim()) return;
    try {
      handleImport(JSON.parse(importJson));
    } catch {
      alert('JSON formatı hatalı');
    }
  };

  // Marketplace sheets to parse (sheet name → marketplace code)
  const MARKETPLACE_SHEETS = ['US', 'EU', 'UK', 'CA', 'AU'];

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const items: { iwasku: string; quantity: number; desi: number; category: string; marketplace: string }[] = [];

        // Parse each marketplace sheet
        for (const sheetName of wb.SheetNames) {
          const marketplace = MARKETPLACE_SHEETS.find(
            m => sheetName.toUpperCase().startsWith(m)
          );
          if (!marketplace) continue; // Skip non-marketplace sheets (e.g. "Ülke Özet", "Yöntem")

          const ws = wb.Sheets[sheetName]!;
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

          for (const row of rows) {
            const iwasku = String(row['iwasku'] || row['IWASKU'] || '');
            if (!iwasku) continue;

            // Quantity: q4 26 + q1 27 (or fallbacks)
            const q4 = Number(row['q4 26'] || row['Q4 26'] || row["Q4'26\nAğır.+15%"] || row['quantity'] || 0);
            const q1 = Number(row['q1 27'] || row['Q1 27'] || row["Q1'27\nAğır.+15%"] || 0);
            const quantity = Math.round(q4 + q1);
            if (quantity <= 0) continue;

            const desi = Number(row['desi'] || row['Desi'] || row['Desi/Un'] || 0);
            const category = String(row['kategori'] || row['Kategori'] || row['category'] || '');

            items.push({ iwasku, quantity, desi, category, marketplace });
          }
        }

        if (items.length === 0) {
          alert('Excel\'de geçerli veri bulunamadı.\nBeklenen format: Sheet adı = US/EU/UK/CA/AU\nKolonlar: iwasku, kategori, desi, q4 26, q1 27');
          return;
        }

        // Default months (Apr-Nov 2026)
        const defaultMonths = [
          { month: '2026-04', workingDays: 18, desiPerDay: 500 },
          { month: '2026-05', workingDays: 16, desiPerDay: 500 },
          { month: '2026-06', workingDays: 25, desiPerDay: 500 },
          { month: '2026-07', workingDays: 19, desiPerDay: 400 },
          { month: '2026-08', workingDays: 25, desiPerDay: 400 },
          { month: '2026-09', workingDays: 20, desiPerDay: 450 },
          { month: '2026-10', workingDays: 19, desiPerDay: 500 },
          { month: '2026-11', workingDays: 20, desiPerDay: 500 },
        ];

        const marketplaceCount = new Set(items.map(i => i.marketplace)).size;
        alert(`${items.length} satır okundu (${marketplaceCount} marketplace). Aktarılıyor...`);
        handleImport({ items, months: defaultMonths, autoAllocate: true });
      } catch {
        alert('Excel dosyası okunamadı');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = ''; // Reset file input
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!confirm(`Havuz durumu "${newStatus}" olarak değiştirilsin mi?`)) return;
    const res = await fetch(`/api/stock-pools/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (data.success) fetchPool();
    else alert(data.error);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard/seasonal')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{pool.name}</h1>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[pool.status] ?? ''}`}>
                {pool.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 font-mono">{pool.code}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {pool.status === 'ACTIVE' && (
            <button onClick={() => handleStatusChange('RELEASING')}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
              <Truck className="w-4 h-4" /> Sevkiyat Başlat
            </button>
          )}
          {(pool.status === 'ACTIVE' || pool.status === 'RELEASING') && (
            <button onClick={() => handleStatusChange('CANCELLED')}
              className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg hover:bg-red-100">
              <XCircle className="w-4 h-4" /> İptal
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <Package className="w-5 h-5 text-gray-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-gray-900">{pool.reserves.length}</p>
          <p className="text-xs text-gray-500">Ürün</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <BarChart3 className="w-5 h-5 text-purple-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-gray-900">{Math.round(totalDesi).toLocaleString('tr-TR')}</p>
          <p className="text-xs text-gray-500">Hedef Desi</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <TrendingUp className="w-5 h-5 text-green-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-green-600">{prodPct}%</p>
          <p className="text-xs text-gray-500">Üretim</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <Truck className="w-5 h-5 text-blue-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-blue-600">{shipPct}%</p>
          <p className="text-xs text-gray-500">Sevkiyat</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('reserves')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'reserves' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Ürünler ({pool.reserves.length})
        </button>
        <button
          onClick={() => setTab('allocations')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'allocations' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Calendar className="w-4 h-4 inline mr-1" />
          Aylık Dağılım
        </button>
      </div>

      {/* Reserves Tab */}
      {tab === 'reserves' && (
        <div className="bg-white border rounded-xl overflow-hidden">
          {/* Import section */}
          {pool.status === 'ACTIVE' && (
            <div className="border-b p-4 bg-gray-50">
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-purple-600 hover:text-purple-700">
                  <Upload className="w-4 h-4" />
                  Talep Aktarımı
                </summary>
                <div className="mt-3 space-y-4">
                  {/* Excel Upload */}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 cursor-pointer">
                      <FileSpreadsheet className="w-4 h-4" />
                      Excel Yükle (.xlsx)
                      <input type="file" accept=".xlsx,.xls" onChange={handleExcelImport} className="hidden" />
                    </label>
                    <span className="text-xs text-gray-500">Sheet başına ülke (US/EU/UK/CA/AU), kolonlar: iwasku, kategori, desi, q4 26, q1 27</span>
                    {importing && <Loader2 className="w-4 h-4 animate-spin text-purple-500" />}
                  </div>

                  {/* JSON fallback */}
                  <details className="text-xs">
                    <summary className="text-gray-400 cursor-pointer hover:text-gray-600">veya JSON ile aktar</summary>
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={importJson}
                        onChange={e => setImportJson(e.target.value)}
                        placeholder='{"items": [...], "months": [...], "autoAllocate": true}'
                        rows={3}
                        className="w-full px-3 py-2 border rounded-lg text-xs font-mono focus:ring-2 focus:ring-purple-500"
                      />
                      <button
                        onClick={handleJsonImport} disabled={importing}
                        className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                      >
                        {importing && <Loader2 className="w-3 h-3 animate-spin" />}
                        JSON Aktar
                      </button>
                    </div>
                  </details>
                </div>
              </details>
            </div>
          )}

          {/* Reserve table */}
          {pool.reserves.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">IWASKU</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Hedef</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Üretilen</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Sevk</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Desi</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Pazar</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pool.reserves.map(r => {
                    const pct = r.targetQuantity > 0 ? Math.round(r.producedQuantity / r.targetQuantity * 100) : 0;
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs">{r.iwasku}</td>
                        <td className="text-center px-3 py-3">{r.targetQuantity}</td>
                        <td className="text-center px-3 py-3">
                          <span className={r.producedQuantity >= r.targetQuantity ? 'text-green-600 font-medium' : ''}>
                            {r.producedQuantity}
                          </span>
                        </td>
                        <td className="text-center px-3 py-3">{r.shippedQuantity}</td>
                        <td className="text-center px-3 py-3 text-gray-500">{r.targetDesi ? Math.round(r.targetDesi) : '—'}</td>
                        <td className="text-center px-3 py-3 text-xs text-gray-500">{r.destination ?? '—'}</td>
                        <td className="text-center px-3 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status] ?? ''}`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Henüz ürün aktarılmadı</p>
              <p className="text-gray-400 text-sm mt-1">Yukarıdaki &quot;Talep Aktarımı&quot; ile başlayın</p>
            </div>
          )}
        </div>
      )}

      {/* Allocations Tab */}
      {tab === 'allocations' && (
        <div className="bg-white border rounded-xl overflow-hidden">
          {monthSummary.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Ay</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Planlanan Ünite</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Gerçekleşen</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Planlanan Desi</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">İlerleme</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {monthSummary.map(([month, data]) => {
                    const pct = data.planned > 0 ? Math.round(data.actual / data.planned * 100) : 0;
                    return (
                      <tr key={month} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{month}</td>
                        <td className="text-center px-3 py-3">{data.planned.toLocaleString('tr-TR')}</td>
                        <td className="text-center px-3 py-3">{data.actual.toLocaleString('tr-TR')}</td>
                        <td className="text-center px-3 py-3 text-gray-500">{Math.round(data.desi).toLocaleString('tr-TR')}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                            <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Aylık dağılım henüz oluşturulmadı</p>
              <p className="text-gray-400 text-sm mt-1">Ürün aktarımı yapıldığında otomatik oluşturulur</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
