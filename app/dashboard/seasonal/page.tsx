/**
 * Seasonal Planning Dashboard
 * Lists all stock pools with stats, create new pool, import demand
 * Admin only
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  CalendarRange, Plus, Upload, Package, TrendingUp, Truck,
  ChevronRight, AlertCircle, CheckCircle2, Loader2, XCircle,
} from 'lucide-react';

interface PoolStats {
  reserveCount: number;
  totalTargetUnits: number;
  totalTargetDesi: number;
  totalProduced: number;
  totalShipped: number;
  productionProgress: number;
  shippingProgress: number;
}

interface StockPool {
  id: string;
  name: string;
  code: string;
  poolType: string;
  targetQuarter: string | null;
  status: string;
  productionStart: string | null;
  targetShipDate: string | null;
  totalTargetDesi: number | null;
  totalTargetUnits: number | null;
  notes: string | null;
  createdAt: string;
  stats: PoolStats;
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  ACTIVE: { label: 'Aktif', color: 'bg-green-100 text-green-700', icon: TrendingUp },
  RELEASING: { label: 'Sevkiyat', color: 'bg-blue-100 text-blue-700', icon: Truck },
  COMPLETED: { label: 'Tamamlandı', color: 'bg-gray-100 text-gray-600', icon: CheckCircle2 },
  CANCELLED: { label: 'İptal', color: 'bg-red-100 text-red-600', icon: XCircle },
};

export default function SeasonalPage() {
  const { role } = useAuth();
  const [pools, setPools] = useState<StockPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', targetQuarter: '', notes: '' });

  const fetchPools = useCallback(async () => {
    try {
      const res = await fetch('/api/stock-pools');
      const data = await res.json();
      if (data.success) setPools(data.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPools(); }, [fetchPools]);

  if (role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-gray-600">Bu sayfaya erişim yetkiniz yok.</p>
        </div>
      </div>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/stock-pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          code: form.code.toUpperCase(),
          poolType: 'SEASONAL',
          targetQuarter: form.targetQuarter || undefined,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreate(false);
        setForm({ name: '', code: '', targetQuarter: '', notes: '' });
        fetchPools();
      } else {
        alert(data.error || 'Havuz oluşturulamadı');
      }
    } catch {
      alert('Bağlantı hatası');
    } finally {
      setCreating(false);
    }
  };

  const activePools = pools.filter(p => p.status === 'ACTIVE' || p.status === 'RELEASING');
  const archivedPools = pools.filter(p => p.status === 'COMPLETED' || p.status === 'CANCELLED');

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <CalendarRange className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sezon Planlaması</h1>
            <p className="text-sm text-gray-500">Sezonsal üretim havuzları ve stok yönetimi</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yeni Havuz
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white border border-purple-200 rounded-xl p-6 space-y-4">
          <h3 className="font-semibold text-gray-900">Yeni Sezon Havuzu</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Havuz Adı</label>
              <input
                type="text" required value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Sezon Q4 2026"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Kod</label>
              <input
                type="text" required value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="SZN-Q4-2026"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hedef Çeyrek</label>
              <input
                type="text" value={form.targetQuarter}
                onChange={e => setForm(f => ({ ...f, targetQuarter: e.target.value }))}
                placeholder="Q4-2026"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Not</label>
              <input
                type="text" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Opsiyonel açıklama"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit" disabled={creating}
              className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {creating && <Loader2 className="w-4 h-4 animate-spin" />}
              Oluştur
            </button>
            <button
              type="button" onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              İptal
            </button>
          </div>
        </form>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        </div>
      )}

      {/* Active Pools */}
      {!loading && activePools.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Aktif Havuzlar</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {activePools.map(pool => (
              <PoolCard key={pool.id} pool={pool} />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && pools.length === 0 && (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Henüz havuz yok</h3>
          <p className="text-gray-500 mb-6">İlk sezon havuzunuzu oluşturarak başlayın.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Yeni Havuz Oluştur
          </button>
        </div>
      )}

      {/* Archived */}
      {!loading && archivedPools.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Arşiv</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {archivedPools.map(pool => (
              <PoolCard key={pool.id} pool={pool} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PoolCard({ pool }: { pool: StockPool }) {
  const config = statusConfig[pool.status] ?? statusConfig.ACTIVE;
  const StatusIcon = config.icon;

  return (
    <Link
      href={`/dashboard/seasonal/${pool.id}`}
      className="bg-white border border-gray-200 rounded-xl p-5 hover:border-purple-300 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 group-hover:text-purple-700 transition-colors">
              {pool.name}
            </h3>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
              <StatusIcon className="w-3 h-3" />
              {config.label}
            </span>
          </div>
          <p className="text-xs text-gray-500 font-mono">{pool.code}</p>
          {pool.targetQuarter && (
            <p className="text-xs text-gray-400 mt-1">Hedef: {pool.targetQuarter}</p>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-purple-500 transition-colors" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">{pool.stats.reserveCount}</p>
          <p className="text-xs text-gray-500">Ürün</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">
            {pool.stats.totalTargetDesi > 0 ? pool.stats.totalTargetDesi.toLocaleString('tr-TR') : '—'}
          </p>
          <p className="text-xs text-gray-500">Hedef Desi</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">{pool.stats.totalTargetUnits.toLocaleString('tr-TR')}</p>
          <p className="text-xs text-gray-500">Hedef Ünite</p>
        </div>
      </div>

      {/* Progress bars */}
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">Üretim</span>
            <span className="font-medium text-gray-700">{pool.stats.productionProgress}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, pool.stats.productionProgress)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">Sevkiyat</span>
            <span className="font-medium text-gray-700">{pool.stats.shippingProgress}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, pool.stats.shippingProgress)}%` }}
            />
          </div>
        </div>
      </div>

      {pool.notes && (
        <p className="text-xs text-gray-400 mt-3 truncate">{pool.notes}</p>
      )}
    </Link>
  );
}
