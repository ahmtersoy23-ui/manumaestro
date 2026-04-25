/**
 * Depo Lobby — kullanıcının erişebileceği depoları kart olarak listeler.
 * Ankara (TOTALS_PRIMARY) için: tek toplam stok rakamı + ürün sayısı + raf sayısı.
 * NJ/Showroom (SHELF_PRIMARY) için: tekil + koli + raf kırılımı.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Warehouse as WarehouseIcon, AlertTriangle, Package, Box, Layers } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DepolarLobby');

type WarehouseCard = {
  code: string;
  name: string;
  region: string;
  stockMode: 'TOTALS_PRIMARY' | 'SHELF_PRIMARY';
  role: string | null;
  summary:
    | {
        mode: 'TOTALS_PRIMARY';
        shelfCount: number;
        totalQty: number;
        productCount: number;
        pendingUnmatched: number;
      }
    | {
        mode: 'SHELF_PRIMARY';
        shelfCount: number;
        looseSkuLines: number;
        looseTotalQty: number;
        boxCount: number;
        boxTotalQty: number;
        pendingUnmatched: number;
      };
};

export default function DepolarLobbyPage() {
  const [warehouses, setWarehouses] = useState<WarehouseCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/depolar', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setWarehouses(d.data);
        else setError(d.error || 'Depolar yüklenemedi');
      })
      .catch((e) => {
        logger.error('Lobby fetch error', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Depolar yükleniyor…</div>;
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
    );
  }
  if (warehouses.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        Hiçbir depoya erişim yetkiniz yok. Yöneticinizden izin isteyin.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Depolar</h1>
        <p className="text-sm text-gray-500 mt-1">
          Bir depo seçin ve içeride Dashboard / Raf / Sipariş sekmelerini kullanın.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {warehouses.map((w) => (
          <Link
            key={w.code}
            href={`/dashboard/depolar/${w.code}`}
            className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-400 hover:shadow-md transition-all"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-blue-50 flex items-center justify-center">
                  <WarehouseIcon className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900">{w.name}</h2>
                  <p className="text-xs text-gray-500">
                    {w.region} • {w.stockMode === 'TOTALS_PRIMARY' ? 'Toplam-bazlı' : 'Raf-bazlı'}
                  </p>
                </div>
              </div>
              <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-gray-100 text-gray-600">
                {w.role ?? '—'}
              </span>
            </div>

            {w.summary.mode === 'TOTALS_PRIMARY' ? (
              <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
                <div className="border-r border-gray-100 pr-2">
                  <p className="text-[11px] text-gray-500 flex items-center gap-1">
                    <Package className="w-3 h-3" /> Toplam Mevcut
                  </p>
                  <p className="font-semibold text-gray-900 text-lg">{w.summary.totalQty}</p>
                  <p className="text-[10px] text-gray-400">{w.summary.productCount} ürün</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-500 flex items-center gap-1">
                    <Layers className="w-3 h-3" /> Raf Kırılımı
                  </p>
                  <p className="font-semibold text-gray-900 text-lg">{w.summary.shelfCount}</p>
                  <p className="text-[10px] text-gray-400">raf tanımlı</p>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
                <div className="border-r border-gray-100 pr-2">
                  <p className="text-[11px] text-gray-500 flex items-center gap-1">
                    <Package className="w-3 h-3" /> Tekil
                  </p>
                  <p className="font-semibold text-gray-900">{w.summary.looseTotalQty}</p>
                  <p className="text-[10px] text-gray-400">{w.summary.looseSkuLines} satır</p>
                </div>
                <div className="border-r border-gray-100 pr-2">
                  <p className="text-[11px] text-gray-500 flex items-center gap-1">
                    <Box className="w-3 h-3" /> Koli
                  </p>
                  <p className="font-semibold text-gray-900">{w.summary.boxTotalQty}</p>
                  <p className="text-[10px] text-gray-400">{w.summary.boxCount} koli</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-500">Raf</p>
                  <p className="font-semibold text-gray-900">{w.summary.shelfCount}</p>
                </div>
              </div>
            )}

            {w.summary.pendingUnmatched > 0 && (
              <div className="mt-4 flex items-center gap-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <AlertTriangle className="w-4 h-4" />
                {w.summary.pendingUnmatched} eşleşmeyen kayıt mapping bekliyor
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
