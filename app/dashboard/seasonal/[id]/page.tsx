/**
 * Stock Pool Detail Page
 * Shows reserves, monthly allocation preview/approve, import functionality
 * Admin only
 */

'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  Home, Upload, Package, TrendingUp, Truck, AlertCircle,
  Loader2, CheckCircle2, XCircle, BarChart3, Calendar, FileSpreadsheet,
  CalendarRange, Eye, ThumbsUp, Lock, Send, Edit2, X, Warehouse, Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface Reserve {
  id: string;
  iwasku: string;
  productName: string | null;
  category: string | null;
  targetQuantity: number;
  targetDesi: number | null;
  desiPerUnit: number | null;
  initialStock: number;
  producedQuantity: number;
  shippedQuantity: number;
  status: string;
  destination: string | null;
  marketplaceSplit: Record<string, number> | null;
  allocations: { month: string; plannedQty: number; plannedDesi: number | null; actualQty: number; locked: boolean }[];
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

interface AllocationPreview {
  month: string;
  totalQty: number;
  totalDesi: number;
  productCount: number;
}

interface MonthQuota {
  month: string;
  workingDays: number;
  desiPerDay: number;
  quotaDesi: number;
  locked?: boolean;
}

const statusColors: Record<string, string> = {
  PLANNED: 'bg-gray-100 text-gray-600',
  PRODUCING: 'bg-yellow-100 text-yellow-700',
  STOCKED: 'bg-green-100 text-green-700',
  RELEASING: 'bg-blue-100 text-blue-700',
  SHIPPED: 'bg-purple-100 text-purple-700',
  CANCELLED: 'bg-red-100 text-red-600',
};

// Production months from haftalik-is-gunleri-2026.xlsx
// Haz: 20g normal + 5g tatil = 480avg, Eyl: 10g tatil + 10g normal = 450avg
const DEFAULT_MONTHS = [
  { month: '2026-04', workingDays: 23, desiPerDay: 500 },
  { month: '2026-05', workingDays: 16, desiPerDay: 500 },
  { month: '2026-06', workingDays: 25, desiPerDay: 480 },
  { month: '2026-07', workingDays: 19, desiPerDay: 400 },
  { month: '2026-08', workingDays: 25, desiPerDay: 400 },
  { month: '2026-09', workingDays: 20, desiPerDay: 450 },
  { month: '2026-10', workingDays: 19, desiPerDay: 500 },
  { month: '2026-11', workingDays: 20, desiPerDay: 500 },
];

const MONTH_LABELS: Record<string, string> = {
  '2026-04': 'Nisan', '2026-05': 'Mayıs', '2026-06': 'Haziran', '2026-07': 'Temmuz',
  '2026-08': 'Ağustos', '2026-09': 'Eylül', '2026-10': 'Ekim', '2026-11': 'Kasım',
};

export default function PoolDetailPage() {
  const { role } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'reserves' | 'allocations' | 'production'>('reserves');
  const [statUnit, setStatUnit] = useState<'unit' | 'desi'>('unit');
  const [importing, setImporting] = useState(false);
  const [importJson, setImportJson] = useState('');

  // Allocation preview state
  const [preview, setPreview] = useState<AllocationPreview[] | null>(null);
  const [previewQuotas, setPreviewQuotas] = useState<MonthQuota[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [lockedMonths, setLockedMonths] = useState<string[]>([]);

  // Release (Ay Planına Aktar) state
  const [releasing, setReleasing] = useState(false);

  // Inline reserve editing state
  const [editingReserveId, setEditingReserveId] = useState<string | null>(null);
  const [editSplit, setEditSplit] = useState<Record<string, number>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingReserveId, setDeletingReserveId] = useState<string | null>(null);


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
        <Link href="/dashboard" className="text-purple-600 text-sm mt-2 inline-block">Ana sayfaya dön</Link>
      </div>
    );
  }

  // Ünite bazlı
  const totalInitial = pool.reserves.reduce((s, r) => s + r.initialStock, 0);
  const totalTarget = pool.reserves.reduce((s, r) => s + r.targetQuantity, 0);
  const totalProduced = pool.reserves.reduce((s, r) => s + r.producedQuantity, 0);
  const totalShipped = pool.reserves.reduce((s, r) => s + r.shippedQuantity, 0);
  const totalDemand = totalInitial + totalTarget;
  const totalFulfilled = totalInitial + totalProduced;

  // Desi bazlı (sabit desiPerUnit field'ından)
  const desiOf = (r: Reserve) => r.desiPerUnit ?? (r.targetDesi && r.targetQuantity > 0 ? r.targetDesi / r.targetQuantity : 0);
  const totalInitialDesi = Math.round(pool.reserves.reduce((s, r) => s + r.initialStock * desiOf(r), 0));
  const totalTargetDesi = Math.round(pool.reserves.reduce((s, r) => s + (r.targetDesi ?? 0), 0));
  const totalProducedDesi = Math.round(pool.reserves.reduce((s, r) => s + r.producedQuantity * desiOf(r), 0));
  const totalShippedDesi = Math.round(pool.reserves.reduce((s, r) => s + r.shippedQuantity * desiOf(r), 0));
  const totalDemandDesi = totalInitialDesi + totalTargetDesi;
  const totalFulfilledDesi = totalInitialDesi + totalProducedDesi;

  // Toggle bazlı değerler
  const s = statUnit === 'desi'
    ? { demand: totalDemandDesi, initial: totalInitialDesi, remaining: totalTargetDesi, fulfilled: totalFulfilledDesi, shipped: totalShippedDesi, suffix: ' desi' }
    : { demand: totalDemand, initial: totalInitial, remaining: totalTarget, fulfilled: totalFulfilled, shipped: totalShipped, suffix: '' };
  const prodPct = s.demand > 0 ? Math.round(s.fulfilled / s.demand * 100) : 0;
  const shipPct = s.demand > 0 ? Math.round(s.shipped / s.demand * 100) : 0;

  // Saved monthly allocation summary (from DB)
  const monthMap = new Map<string, { planned: number; actual: number; desi: number; locked: boolean }>();
  for (const r of pool.reserves) {
    for (const a of r.allocations) {
      const m = monthMap.get(a.month) ?? { planned: 0, actual: 0, desi: 0, locked: false };
      m.planned += a.plannedQty;
      m.actual += a.actualQty;
      m.desi += a.plannedDesi ?? 0;
      if (a.locked) m.locked = true;
      monthMap.set(a.month, m);
    }
  }
  const savedAllocations = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const hasAllocations = savedAllocations.length > 0;

  const handleImport = async (payload: Record<string, unknown>) => {
    setImporting(true);
    try {
      // Always import without auto-allocate — user must approve separately
      const res = await fetch(`/api/stock-pools/${id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, autoAllocate: false }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`${data.data.reservesCreated} ürün aktarıldı. Aylık Dağılım sekmesinden dağılımı önizleyip onaylayabilirsiniz.`);
        setImportJson('');
        setPreview(null); // Clear any old preview
        fetchPool();
        setTab('allocations'); // Switch to allocations tab
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

  // Marketplace sheets to parse
  const MARKETPLACE_SHEETS = ['US', 'EU', 'UK', 'CA', 'AU'];

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const items: { iwasku: string; quantity: number; desi: number; category: string; marketplace: string }[] = [];

        for (const sheetName of wb.SheetNames) {
          const marketplace = MARKETPLACE_SHEETS.find(
            m => sheetName.toUpperCase().startsWith(m)
          );
          if (!marketplace) continue;

          const ws = wb.Sheets[sheetName]!;
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

          for (const row of rows) {
            const iwasku = String(row['iwasku'] || row['IWASKU'] || '');
            if (!iwasku) continue;

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

        const marketplaceCount = new Set(items.map(i => i.marketplace)).size;
        alert(`${items.length} satır okundu (${marketplaceCount} marketplace). Aktarılıyor...`);
        handleImport({ items, months: DEFAULT_MONTHS });
      } catch {
        alert('Excel dosyası okunamadı');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // Preview allocation (without saving)
  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const res = await fetch(`/api/stock-pools/${id}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: DEFAULT_MONTHS, approve: false }),
      });
      const data = await res.json();
      if (data.success) {
        setPreview(data.data.summary);
        setPreviewQuotas(data.data.monthQuotas);
        setLockedMonths(data.data.lockedMonths ?? []);
      } else {
        alert(data.error || 'Önizleme başarısız');
      }
    } catch {
      alert('Bağlantı hatası');
    } finally {
      setPreviewing(false);
    }
  };

  // Approve and save allocation
  const handleApprove = async () => {
    if (!confirm('Aylık dağılım onaylansın mı? Mevcut dağılım varsa üzerine yazılacak.')) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/stock-pools/${id}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: DEFAULT_MONTHS, approve: true }),
      });
      const data = await res.json();
      if (data.success) {
        alert('Dağılım onaylandı ve kaydedildi.');
        setPreview(null);
        fetchPool();
      } else {
        alert(data.error || 'Onay başarısız');
      }
    } catch {
      alert('Bağlantı hatası');
    } finally {
      setApproving(false);
    }
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

  const handleDeleteAndRestart = async () => {
    if (!confirm('Havuz silinip yeni boş havuz oluşturulacak. Emin misiniz?')) return;
    try {
      const delRes = await fetch(`/api/stock-pools/${id}`, { method: 'DELETE' });
      const delData = await delRes.json();
      if (delData.success) {
        // Redirect to /dashboard/seasonal which will auto-create a new pool
        router.replace('/dashboard/seasonal');
      } else {
        alert(delData.error || 'Silme başarısız');
      }
    } catch {
      alert('Bağlantı hatası');
    }
  };

  const handleRelease = async () => {
    if (!confirm('Onaylı dağılım ay planına aktarılsın mı? Kilitli aylar korunur, açık aylar yeniden oluşturulur.')) return;
    setReleasing(true);
    try {
      const res = await fetch(`/api/stock-pools/${id}/release`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(`${data.data.created} üretim isteği oluşturuldu. Ay planında "Sezon" olarak görünür.`);
      } else {
        alert(data.error || 'Aktarım başarısız');
      }
    } catch {
      alert('Bağlantı hatası');
    } finally {
      setReleasing(false);
    }
  };

  const handleSaveEdit = async (reserveId: string) => {
    if (Object.values(editSplit).some(v => isNaN(v) || v < 0)) { alert('Geçersiz miktar'); return; }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/stock-pools/${id}/reserves/${reserveId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketplaceSplit: editSplit }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingReserveId(null);
        setEditSplit({});
        setPreview(null);
        fetchPool();
      } else {
        alert(data.error || 'Güncelleme başarısız');
      }
    } catch {
      alert('Bağlantı hatası');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteReserve = async (reserveId: string, iwasku: string) => {
    if (!confirm(`"${iwasku}" rezervini silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) return;
    setDeletingReserveId(reserveId);
    try {
      const res = await fetch(`/api/stock-pools/${id}/reserves/${reserveId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setPreview(null);
        fetchPool();
      } else {
        alert(data.error || 'Silme başarısız');
      }
    } catch {
      alert('Bağlantı hatası');
    } finally {
      setDeletingReserveId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-lg" title="Ana Sayfa">
            <Home className="w-5 h-5 text-gray-400" />
          </Link>
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <CalendarRange className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">Sezon Planlaması</h1>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[pool.status] ?? ''}`}>
                {pool.status}
              </span>
            </div>
            <p className="text-sm text-gray-500">Sezonsal üretim havuzu ve stok yönetimi</p>
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
          <button onClick={handleDeleteAndRestart}
            className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700">
            <Package className="w-4 h-4" /> Sil ve Yeniden Başla
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="space-y-2">
        <div className="flex justify-end">
          <button
            onClick={() => setStatUnit(statUnit === 'unit' ? 'desi' : 'unit')}
            className="text-xs px-2.5 py-1 rounded-md border bg-white text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {statUnit === 'unit' ? 'Adet' : 'Desi'} gösteriliyor — <span className="font-medium text-purple-600">{statUnit === 'unit' ? 'Desi' : 'Adet'}</span>
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white border rounded-xl p-4 text-center">
            <Package className="w-5 h-5 text-purple-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-gray-900">{s.demand.toLocaleString('tr-TR')}</p>
            <p className="text-xs text-gray-500">Toplam Talep</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <Warehouse className="w-5 h-5 text-orange-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-orange-600">{s.initial.toLocaleString('tr-TR')}</p>
            <p className="text-xs text-gray-500">Başlangıç</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <BarChart3 className="w-5 h-5 text-gray-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-gray-900">{s.remaining.toLocaleString('tr-TR')}</p>
            <p className="text-xs text-gray-500">Kalan Üretim</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <TrendingUp className="w-5 h-5 text-green-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-green-600">{prodPct}%</p>
            <p className="text-xs text-gray-500">{s.fulfilled.toLocaleString('tr-TR')} / {s.demand.toLocaleString('tr-TR')}</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <Truck className="w-5 h-5 text-blue-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-blue-600">{shipPct}%</p>
            <p className="text-xs text-gray-500">Sevkiyat</p>
          </div>
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
          {!hasAllocations && pool.reserves.length > 0 && (
            <span className="ml-1.5 w-2 h-2 bg-orange-400 rounded-full inline-block" title="Onay bekliyor" />
          )}
        </button>
        <button
          onClick={() => setTab('production')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'production' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <TrendingUp className="w-4 h-4 inline mr-1" />
          Aylık Üretim
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
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 cursor-pointer">
                      <FileSpreadsheet className="w-4 h-4" />
                      Excel Yükle (.xlsx)
                      <input type="file" accept=".xlsx,.xls" onChange={handleExcelImport} className="hidden" />
                    </label>
                    <span className="text-xs text-gray-500">Sheet başına ülke (US/EU/UK/CA/AU), kolonlar: iwasku, kategori, desi, q4 26, q1 27</span>
                    {importing && <Loader2 className="w-4 h-4 animate-spin text-purple-500" />}
                  </div>
                  <details className="text-xs">
                    <summary className="text-gray-400 cursor-pointer hover:text-gray-600">veya JSON ile aktar</summary>
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={importJson}
                        onChange={e => setImportJson(e.target.value)}
                        placeholder='{"items": [...], "months": [...]}'
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
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Ürün</th>
                    <th className="text-left px-3 py-3 font-medium text-gray-500">Kategori</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Başlangıç</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Hedef</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Üretilen</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Sevk</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Desi</th>
                    <th className="text-left px-3 py-3 font-medium text-gray-500">Pazar</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Durum</th>
                    {pool.status === 'ACTIVE' && <th className="px-3 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pool.reserves.map(r => {
                    const split = r.marketplaceSplit ?? {};
                    const splitEntries = Object.entries(split).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 max-w-[320px]">
                          <p className="font-mono text-xs text-gray-900">{r.iwasku}</p>
                          {r.productName && (
                            <p className="text-xs text-gray-500 mt-0.5 leading-snug">{r.productName}</p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-600 max-w-[100px] truncate" title={r.category ?? ''}>
                          {r.category ?? '—'}
                        </td>
                        <td className="text-center px-3 py-3 text-orange-600 font-medium">{r.initialStock > 0 ? r.initialStock : '—'}</td>
                        <td className="text-center px-3 py-3 font-medium text-gray-900">{r.targetQuantity}</td>
                        <td className="text-center px-3 py-3">
                          <span className={r.producedQuantity >= r.targetQuantity ? 'text-green-600 font-medium' : 'text-gray-900'}>
                            {r.producedQuantity}
                          </span>
                        </td>
                        <td className="text-center px-3 py-3 text-gray-900">{r.shippedQuantity}</td>
                        <td className="text-center px-3 py-3 text-gray-500">{r.targetDesi ? Math.round(r.targetDesi) : '—'}</td>
                        <td className="px-3 py-3">
                          {splitEntries.length > 0 ? (
                            <div className="flex flex-wrap gap-0.5">
                              {splitEntries.map(([code, qty]) => (
                                <span key={code} className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                                  {code}:{qty}
                                </span>
                              ))}
                            </div>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="text-center px-3 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status] ?? ''}`}>
                            {r.status}
                          </span>
                        </td>
                        {pool.status === 'ACTIVE' && (
                          <td className="px-3 py-3 text-right align-top">
                            {editingReserveId === r.id ? (
                              <div className="min-w-[170px]">
                                {Object.entries(editSplit).map(([code, qty], i) => (
                                  <div key={code} className="flex items-center gap-1.5 mb-1">
                                    <span className="text-xs font-semibold text-gray-700 w-8 text-left">{code}</span>
                                    <input
                                      type="number"
                                      value={qty}
                                      onChange={e => setEditSplit(prev => ({ ...prev, [code]: parseInt(e.target.value) || 0 }))}
                                      min={0}
                                      autoFocus={i === 0}
                                      onKeyDown={e => { if (e.key === 'Escape') setEditingReserveId(null); }}
                                      className="w-16 px-1.5 py-0.5 border rounded text-xs text-center focus:ring-1 focus:ring-purple-500"
                                    />
                                  </div>
                                ))}
                                <div className="text-xs text-gray-500 text-right mb-1.5 pr-0.5">
                                  Toplam: <span className="font-semibold text-gray-900">{Object.values(editSplit).reduce((s, v) => s + v, 0)}</span>
                                </div>
                                <div className="flex gap-1 justify-end">
                                  <button
                                    onClick={() => handleSaveEdit(r.id)}
                                    disabled={savingEdit}
                                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                                    title="Kaydet"
                                  >
                                    {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                  </button>
                                  <button
                                    onClick={() => setEditingReserveId(null)}
                                    className="p-1 text-gray-400 hover:bg-gray-50 rounded"
                                    title="İptal"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 justify-end">
                                <button
                                  onClick={() => {
                                    const split = r.marketplaceSplit && Object.keys(r.marketplaceSplit).length > 0
                                      ? { ...r.marketplaceSplit }
                                      : { TOTAL: r.targetQuantity };
                                    setEditingReserveId(r.id);
                                    setEditSplit(split as Record<string, number>);
                                  }}
                                  className="p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded"
                                  title="Hedefi düzenle"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteReserve(r.id, r.iwasku)}
                                  disabled={deletingReserveId === r.id}
                                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                  title="Sil"
                                >
                                  {deletingReserveId === r.id
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <Trash2 className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            )}
                          </td>
                        )}
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
        <div className="space-y-4">
          {/* Saved Allocations */}
          {hasAllocations && (
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b bg-green-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-medium text-green-700">Onaylı Dağılım</span>
                  {savedAllocations.some(([, d]) => d.locked) && (
                    <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                      <Lock className="w-3 h-3" /> Kilitli aylar var
                    </span>
                  )}
                </div>
                <button
                  onClick={handleRelease}
                  disabled={releasing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  title="Onaylı dağılımı ay planına ProductionRequest olarak aktar"
                >
                  {releasing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Ay Planına Aktar
                </button>
              </div>
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
                    {savedAllocations.map(([month, data]) => {
                      const pct = data.planned > 0 ? Math.round(data.actual / data.planned * 100) : 0;
                      return (
                        <tr key={month} className={`hover:bg-gray-50 ${data.locked ? 'bg-orange-50/40' : ''}`}>
                          <td className="px-4 py-3 font-medium">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={async () => {
                                  const newLocked = !data.locked;
                                  try {
                                    const res = await fetch(`/api/stock-pools/${id}/lock-month`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ month, locked: newLocked }),
                                    });
                                    const d = await res.json();
                                    if (d.success) fetchPool();
                                    else alert(d.error || 'İşlem başarısız');
                                  } catch { alert('Bağlantı hatası'); }
                                }}
                                className={`p-0.5 rounded transition-colors ${data.locked ? 'text-orange-500 hover:text-orange-700' : 'text-gray-300 hover:text-gray-500'}`}
                                title={data.locked ? 'Kilidi aç' : 'Kilitle'}
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </button>
                              {MONTH_LABELS[month] ?? month}
                            </div>
                          </td>
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
            </div>
          )}

          {/* Preview / Calculate Section */}
          {pool.status === 'ACTIVE' && pool.reserves.length > 0 && (
            <div className="bg-white border border-purple-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b bg-purple-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-medium text-purple-700">
                    {preview ? 'Dağılım Önizleme' : 'Dağılımı Hesapla'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handlePreview}
                    disabled={previewing}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    {previewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                    {preview ? 'Yeniden Hesapla' : 'Önizle'}
                  </button>
                  {preview && (
                    <button
                      onClick={handleApprove}
                      disabled={approving}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      {approving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
                      Onayla
                    </button>
                  )}
                </div>
              </div>

              {preview && previewQuotas ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Ay</th>
                        <th className="text-center px-3 py-3 font-medium text-blue-600 bg-blue-50">Kota Desi</th>
                        <th className="text-center px-3 py-3 font-medium text-purple-600 bg-purple-50">Planlanan Desi</th>
                        <th className="text-center px-3 py-3 font-medium text-gray-500">Kota Kullanımı</th>
                        <th className="text-center px-3 py-3 font-medium text-gray-500">Ünite</th>
                        <th className="text-center px-3 py-3 font-medium text-gray-500">Ürün Sayısı</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {previewQuotas.map(q => {
                        const isLocked = q.locked || lockedMonths.includes(q.month);
                        const alloc = preview.find(p => p.month === q.month);
                        const allocDesi = alloc?.totalDesi ?? 0;
                        const usagePct = q.quotaDesi > 0 ? Math.round(allocDesi / q.quotaDesi * 100) : 0;
                        return (
                          <tr key={q.month} className={`hover:bg-gray-50 ${isLocked ? 'bg-orange-50/40' : ''}`}>
                            <td className="px-4 py-3 font-medium">
                              <span className="flex items-center gap-1.5">
                                {isLocked && <span title="Kilitli — üretimi başlamış"><Lock className="w-3 h-3 text-orange-400 shrink-0" /></span>}
                                {MONTH_LABELS[q.month] ?? q.month}
                              </span>
                              <span className="text-xs text-gray-400 ml-5">{q.workingDays}gün × {q.desiPerDay}</span>
                            </td>
                            <td className="text-center px-3 py-3 font-medium text-blue-700 bg-blue-50/50">
                              {q.quotaDesi.toLocaleString('tr-TR')}
                            </td>
                            <td className="text-center px-3 py-3 font-medium text-purple-700 bg-purple-50/50">
                              {alloc ? Math.round(allocDesi).toLocaleString('tr-TR') : '—'}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${usagePct > 100 ? 'bg-red-500' : usagePct > 80 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                    style={{ width: `${Math.min(100, usagePct)}%` }}
                                  />
                                </div>
                                <span className={`text-xs w-10 text-right font-medium ${usagePct > 100 ? 'text-red-600' : 'text-gray-500'}`}>
                                  {usagePct}%
                                </span>
                              </div>
                            </td>
                            <td className="text-center px-3 py-3">{alloc?.totalQty.toLocaleString('tr-TR') ?? '—'}</td>
                            <td className="text-center px-3 py-3 text-gray-500">{alloc?.productCount ?? '—'}</td>
                          </tr>
                        );
                      })}
                      {/* Totals row */}
                      <tr className="bg-gray-50 font-medium">
                        <td className="px-4 py-3">Toplam</td>
                        <td className="text-center px-3 py-3 text-blue-700">
                          {previewQuotas.reduce((s, q) => s + q.quotaDesi, 0).toLocaleString('tr-TR')}
                        </td>
                        <td className="text-center px-3 py-3 text-purple-700">
                          {Math.round(preview.reduce((s, p) => s + p.totalDesi, 0)).toLocaleString('tr-TR')}
                        </td>
                        <td className="px-3 py-3">
                          {(() => {
                            const totalQuota = previewQuotas.reduce((s, q) => s + q.quotaDesi, 0);
                            const totalAlloc = preview.reduce((s, p) => s + p.totalDesi, 0);
                            const pct = totalQuota > 0 ? Math.round(totalAlloc / totalQuota * 100) : 0;
                            return <span className="text-xs text-gray-500 ml-auto block text-right">{pct}%</span>;
                          })()}
                        </td>
                        <td className="text-center px-3 py-3">
                          {preview.reduce((s, p) => s + p.totalQty, 0).toLocaleString('tr-TR')}
                        </td>
                        <td className="text-center px-3 py-3 text-gray-500">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Calendar className="w-10 h-10 text-purple-200 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">Dağılımı görmek için &quot;Önizle&quot; butonuna tıklayın</p>
                  <p className="text-gray-400 text-xs mt-1">Aylık kotalar ve planlanan desi karşılaştırmalı gösterilir</p>
                </div>
              )}
            </div>
          )}

          {/* No reserves yet */}
          {pool.reserves.length === 0 && !hasAllocations && (
            <div className="bg-white border rounded-xl text-center py-12">
              <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Önce ürün aktarımı yapın</p>
              <button
                onClick={() => setTab('reserves')}
                className="text-purple-600 text-sm mt-2 hover:underline"
              >
                Ürünler sekmesine git
              </button>
            </div>
          )}
        </div>
      )}

      {/* Monthly Production Tab */}
      {tab === 'production' && (
        <MonthlyProductionTab poolId={id} />
      )}
    </div>
  );
}

// ============================================
// Monthly Production Tab Component
// ============================================

function MonthlyProductionTab({ poolId }: { poolId: string }) {
  const [data, setData] = useState<{
    months: { month: string; totalPlanned: number; totalProduced: number; diff: number; productCount: number }[];
    byProduct: { month: string; products: { iwasku: string; planned: number; produced: number }[] }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/stock-pools/${poolId}/monthly-production`)
      .then(res => res.json())
      .then(res => { if (res.success) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [poolId]);

  if (loading) return <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></div>;
  if (!data || data.months.length === 0) {
    return (
      <div className="bg-white border rounded-xl text-center py-12">
        <BarChart3 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">Henüz üretim verisi yok</p>
        <p className="text-gray-400 text-sm mt-1">Haftalık depo girişleri yapıldıkça burada görünecek</p>
      </div>
    );
  }

  const monthLabels: Record<string, string> = {
    '01': 'Ocak', '02': 'Şubat', '03': 'Mart', '04': 'Nisan',
    '05': 'Mayıs', '06': 'Haziran', '07': 'Temmuz', '08': 'Ağustos',
    '09': 'Eylül', '10': 'Ekim', '11': 'Kasım', '12': 'Aralık',
  };
  const formatMonth = (m: string) => `${monthLabels[m.slice(5, 7)] ?? m.slice(5, 7)} ${m.slice(0, 4)}`;

  const totalPlanned = data.months.reduce((s, m) => s + m.totalPlanned, 0);
  const totalProduced = data.months.reduce((s, m) => s + m.totalProduced, 0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalPlanned.toLocaleString('tr-TR')}</p>
          <p className="text-xs text-gray-500">Toplam Planlanan</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{totalProduced.toLocaleString('tr-TR')}</p>
          <p className="text-xs text-gray-500">Toplam Üretilen</p>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className={`text-2xl font-bold ${totalPlanned > 0 ? (totalProduced / totalPlanned >= 0.7 ? 'text-green-600' : 'text-red-600') : 'text-gray-900'}`}>
            {totalPlanned > 0 ? Math.round(totalProduced / totalPlanned * 100) : 0}%
          </p>
          <p className="text-xs text-gray-500">Gerçekleşme</p>
        </div>
      </div>

      {/* Monthly Table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Ay</th>
              <th className="text-center px-3 py-3 font-medium text-gray-500">Planlanan</th>
              <th className="text-center px-3 py-3 font-medium text-gray-500">Üretilen</th>
              <th className="text-center px-3 py-3 font-medium text-gray-500">Fark</th>
              <th className="text-center px-3 py-3 font-medium text-gray-500">İlerleme</th>
              <th className="text-center px-3 py-3 font-medium text-gray-500">Ürün</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.months.map(m => {
              const pct = m.totalPlanned > 0 ? Math.round(m.totalProduced / m.totalPlanned * 100) : 0;
              const pctColor = pct >= 100 ? 'text-green-600' : pct >= 70 ? 'text-yellow-600' : 'text-red-600';
              const barColor = pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-red-500';
              const detail = data.byProduct.find(b => b.month === m.month);

              return (
                <Fragment key={m.month}>
                  <tr
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpandedMonth(expandedMonth === m.month ? null : m.month)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{formatMonth(m.month)}</td>
                    <td className="text-center px-3 py-3 text-gray-900">{m.totalPlanned.toLocaleString('tr-TR')}</td>
                    <td className="text-center px-3 py-3 font-medium text-gray-900">{m.totalProduced.toLocaleString('tr-TR')}</td>
                    <td className={`text-center px-3 py-3 font-medium ${m.diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {m.diff >= 0 ? '+' : ''}{m.diff.toLocaleString('tr-TR')}
                    </td>
                    <td className="text-center px-3 py-3">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-20 bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className={`text-xs font-medium ${pctColor}`}>{pct}%</span>
                      </div>
                    </td>
                    <td className="text-center px-3 py-3 text-gray-500">{m.productCount}</td>
                  </tr>

                  {/* Expanded product detail */}
                  {expandedMonth === m.month && detail && detail.products.length > 0 && (
                    <tr>
                      <td colSpan={6} className="bg-gray-50 px-4 py-2">
                        <div className="max-h-64 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-400">
                                <th className="text-left py-1 px-2">IWASKU</th>
                                <th className="text-center py-1 px-2">Planlanan</th>
                                <th className="text-center py-1 px-2">Üretilen</th>
                                <th className="text-center py-1 px-2">Fark</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {detail.products.map(p => (
                                <tr key={p.iwasku} className="hover:bg-white">
                                  <td className="py-1 px-2 font-mono text-gray-700">{p.iwasku}</td>
                                  <td className="text-center py-1 px-2 text-gray-600">{p.planned}</td>
                                  <td className="text-center py-1 px-2 font-medium text-gray-900">{p.produced}</td>
                                  <td className={`text-center py-1 px-2 font-medium ${p.produced - p.planned >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {p.produced - p.planned >= 0 ? '+' : ''}{p.produced - p.planned}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
