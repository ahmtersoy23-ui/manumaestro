/**
 * Depo Dashboard Sekmesi (default tab).
 * Üstte prominent arama kutusu (henüz stub).
 * Ankara (TOTALS_PRIMARY): toplam mevcut + ürün sayısı + detaylı sayfa link.
 * NJ/Showroom (SHELF_PRIMARY): tekil/koli/raf kırılımı + koli durum dağılımı.
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { Search, Layers, Package, Box, AlertTriangle, History, ExternalLink } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DepoDashboard');

interface Movement {
  id: string;
  type: string;
  iwasku: string | null;
  quantity: number | null;
  fromShelfId: string | null;
  toShelfId: string | null;
  refType: string | null;
  userId: string;
  createdAt: string;
  notes: string | null;
}

type Summary =
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
      boxesByStatus: { status: string; count: number; quantity: number }[];
      pendingUnmatched: number;
    };

interface DepoData {
  warehouse: { code: string; name: string; region: string; stockMode: string };
  role: string;
  summary: Summary;
  recentMovements: Movement[];
}

export default function DepoDashboardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();

  const [data, setData] = useState<DepoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetch(`/api/depolar/${code}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setData(d.data);
        else setError(d.error || 'Veri yüklenemedi');
      })
      .catch((e) => {
        logger.error('Depo fetch error', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => setLoading(false));
  }, [code]);

  if (loading) return <div className="text-center py-12 text-gray-500">Yükleniyor…</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const isAnkara = data.summary.mode === 'TOTALS_PRIMARY';

  return (
    <div className="space-y-6">
      {/* Prominent arama kutusu — sonraki adımda canlanacak */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={
            isAnkara
              ? 'SKU / FNSKU yazın → Ankara stoğunda arama (yakında)'
              : 'SKU / FNSKU yazın → bu deponun raf+koli dağılımı açılacak (yakında)'
          }
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
          disabled
        />
      </div>

      {/* Ankara — TOTALS_PRIMARY view */}
      {data.summary.mode === 'TOTALS_PRIMARY' && (
        <>
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs text-blue-700 mb-1">
              Ankara depo <span className="font-medium">toplam-bazlı</span> izlenir.
              Mevcut detaylı stok takip sayfası hâlâ aktif.
            </p>
            <Link
              href="/dashboard/warehouse-stock"
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900"
            >
              Detaylı Stok Sayfasına Git <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <Package className="w-4 h-4" /> Toplam Mevcut
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.totalQty}</p>
              <p className="text-[11px] text-gray-400">{data.summary.productCount} ürün</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <Layers className="w-4 h-4" /> Raf Kırılımı
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.shelfCount}</p>
              <p className="text-[11px] text-gray-400">raf tanımlı</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <AlertTriangle className="w-4 h-4" /> Eşleşmeyen
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.pendingUnmatched}</p>
              <p className="text-[11px] text-gray-400">mapping bekliyor</p>
            </div>
          </div>
        </>
      )}

      {/* NJ/Showroom — SHELF_PRIMARY view */}
      {data.summary.mode === 'SHELF_PRIMARY' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <Layers className="w-4 h-4" /> Raf
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.shelfCount}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <Package className="w-4 h-4" /> Tekil ürün
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.looseTotalQty}</p>
              <p className="text-[11px] text-gray-400">{data.summary.looseSkuLines} satır</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <Box className="w-4 h-4" /> Koli (mühürlü+kısmi)
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {data.summary.boxesByStatus
                  .filter((b) => b.status !== 'EMPTY')
                  .reduce((s, x) => s + x.quantity, 0)}
              </p>
              <p className="text-[11px] text-gray-400">
                {data.summary.boxesByStatus
                  .filter((b) => b.status !== 'EMPTY')
                  .reduce((s, x) => s + x.count, 0)}{' '}
                koli
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <AlertTriangle className="w-4 h-4" /> Eşleşmeyen
              </div>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.pendingUnmatched}</p>
              <p className="text-[11px] text-gray-400">mapping bekliyor</p>
            </div>
          </div>

          {/* Koli durum dağılımı */}
          {data.summary.boxesByStatus.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Koli Durumu</p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                {(['SEALED', 'PARTIAL', 'EMPTY'] as const).map((status) => {
                  const row = data.summary.mode === 'SHELF_PRIMARY'
                    ? data.summary.boxesByStatus.find((r) => r.status === status)
                    : null;
                  const label =
                    status === 'SEALED' ? 'Mühürlü' : status === 'PARTIAL' ? 'Kısmi açık' : 'Boş';
                  return (
                    <div key={status} className="border border-gray-100 rounded-md p-3">
                      <p className="text-[11px] text-gray-500">{label}</p>
                      <p className="text-lg font-semibold text-gray-900">{row?.count ?? 0}</p>
                      <p className="text-[11px] text-gray-400">{row?.quantity ?? 0} adet</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Son hareketler — her iki mod için */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <History className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-medium text-gray-700">Son Hareketler</h3>
        </div>
        {data.recentMovements.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400">Henüz hareket yok.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Zaman</th>
                <th className="text-left px-4 py-2">Tip</th>
                <th className="text-left px-4 py-2">SKU</th>
                <th className="text-right px-4 py-2">Adet</th>
                <th className="text-left px-4 py-2">Kaynak</th>
                <th className="text-left px-4 py-2">Not</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recentMovements.map((m) => (
                <tr key={m.id} className="text-gray-700">
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {new Date(m.createdAt).toLocaleString('tr-TR')}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">{m.type}</td>
                  <td className="px-4 py-2 font-mono text-xs">{m.iwasku ?? '—'}</td>
                  <td className="px-4 py-2 text-right">{m.quantity ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{m.refType ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 truncate max-w-[200px]">{m.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
