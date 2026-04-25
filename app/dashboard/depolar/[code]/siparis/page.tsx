/**
 * Sipariş Çıkış Sekmesi — sipariş listesi.
 * SINGLE (tekil sipariş) veya FBA_PICKUP (Amazon koli pick-up) tipinde.
 * Yeni yaratma sonraki commit'te (yeni/page.tsx).
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, PackageOpen, Truck, Box as BoxIcon, AlertCircle, Search } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('OutboundList');

interface OrderRow {
  id: string;
  orderType: 'SINGLE' | 'FBA_PICKUP';
  marketplaceCode: string;
  orderNumber: string;
  description: string | null;
  status: 'DRAFT' | 'SHIPPED' | 'CANCELLED';
  itemCount: number;
  createdAt: string;
  shippedAt: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  SHIPPED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Hazırlanıyor',
  SHIPPED: 'Gönderildi',
  CANCELLED: 'İptal',
};

export default function SiparisListPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();

  // Ankara'da sipariş çıkış yok
  if (code === 'ANKARA') {
    redirect(`/dashboard/depolar/${code}`);
  }

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [role, setRole] = useState<string>('VIEWER');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'SHIPPED' | 'CANCELLED'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SINGLE' | 'FBA_PICKUP'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    if (typeFilter !== 'ALL') params.set('orderType', typeFilter);
    fetch(`/api/depolar/${code}/siparis?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          setOrders(d.data.orders);
          setRole(d.data.role ?? 'VIEWER');
        } else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Siparis fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, statusFilter, typeFilter]);

  const canCreate = ['PACKER', 'OPERATOR', 'MANAGER', 'ADMIN'].includes(role);

  const filtered = orders.filter((o) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      o.marketplaceCode.toLowerCase().includes(q) ||
      (o.description ?? '').toLowerCase().includes(q)
    );
  });

  const counts = {
    draftSingle: orders.filter((o) => o.status === 'DRAFT' && o.orderType === 'SINGLE').length,
    draftFba: orders.filter((o) => o.status === 'DRAFT' && o.orderType === 'FBA_PICKUP').length,
    shipped: orders.filter((o) => o.status === 'SHIPPED').length,
    cancelled: orders.filter((o) => o.status === 'CANCELLED').length,
  };

  return (
    <div className="space-y-5">
      {/* Header / Yeni butonlar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Sipariş Çıkış</h1>
          <p className="text-xs text-gray-500">
            DRAFT: {counts.draftSingle + counts.draftFba} • Gönderildi: {counts.shipped} • İptal: {counts.cancelled}
          </p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <Link
              href={`/dashboard/depolar/${code}/siparis/yeni?type=SINGLE`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" /> Yeni Sipariş (Tekil)
            </Link>
            {code === 'NJ' && (
              <Link
                href={`/dashboard/depolar/${code}/siparis/yeni?type=FBA_PICKUP`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-500 text-white rounded-md hover:bg-orange-600"
              >
                <BoxIcon className="w-4 h-4" /> FBA Pick-up
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Filtreler */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-1">
          {(['ALL', 'DRAFT', 'SHIPPED', 'CANCELLED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s === 'ALL' ? 'Hepsi' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['ALL', 'SINGLE', 'FBA_PICKUP'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                typeFilter === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t === 'ALL' ? 'Tüm tipler' : t === 'SINGLE' ? 'Tekil' : 'FBA Pick-up'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Sipariş no, marketplace, açıklama"
            className="w-full pl-9 pr-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-3 h-3" /> {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Yükleniyor…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500">
          <PackageOpen className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          {searchTerm || statusFilter !== 'ALL' || typeFilter !== 'ALL'
            ? 'Filtreyle eşleşen sipariş yok.'
            : 'Henüz sipariş yok. Sağ üstten yeni sipariş yarat.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Tip</th>
                <th className="text-left px-4 py-2">Marketplace</th>
                <th className="text-left px-4 py-2">Sipariş No</th>
                <th className="text-left px-4 py-2">Açıklama</th>
                <th className="text-right px-4 py-2">Kalem</th>
                <th className="text-left px-4 py-2">Durum</th>
                <th className="text-left px-4 py-2">Tarih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((o) => (
                <tr key={o.id} className="text-gray-700 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                      o.orderType === 'FBA_PICKUP'
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {o.orderType === 'FBA_PICKUP' ? 'FBA' : 'Tekil'}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{o.marketplaceCode}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/dashboard/depolar/${code}/siparis/${o.id}`}
                      className="font-mono text-xs text-blue-700 hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600 truncate max-w-[280px]">
                    {o.description ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right">{o.itemCount}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${STATUS_BADGE[o.status]}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {o.shippedAt ? (
                      <span className="flex items-center gap-1">
                        <Truck className="w-3 h-3" />
                        {new Date(o.shippedAt).toLocaleDateString('tr-TR')}
                      </span>
                    ) : (
                      new Date(o.createdAt).toLocaleDateString('tr-TR')
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
