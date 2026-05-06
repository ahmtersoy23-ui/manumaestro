/**
 * Sipariş Çıkış — Pazaryeri Alt Sayfası.
 * /dashboard/depolar/[code]/siparis/marketplace/[mp]
 * Bu sayfa o pazaryerinin: stage sayaçları + sipariş listesi (DRAFT/SHIPPED/CANCELLED)
 * + "Yeni Sipariş Ekle" link'i (yeni form sayfasına gider, dönüşte buraya redirect olur).
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  Plus,
  PackageOpen,
  Truck,
  AlertCircle,
  Search,
} from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('OutboundMarketplace');

const MARKETPLACE_LABELS: Record<string, string> = {
  AMZN_US: 'Amazon US',
  WAYFAIR_US: 'Wayfair US',
  CUSTOM_05: 'Walmart',
  CUSTOM_04: 'eBay',
  CUSTOM_03: 'Etsy',
  CUSTOM_07: 'Shopify',
};

interface OrderRow {
  id: string;
  orderType: 'SINGLE' | 'FBA_PICKUP';
  marketplaceCode: string;
  orderNumber: string;
  description: string | null;
  addressNote: string | null;
  status: 'DRAFT' | 'SHIPPED' | 'CANCELLED';
  itemCount: number;
  hasShippingLabel: boolean;
  createdAt: string;
  shippedAt: string | null;
}

type Stage = 'KARGO' | 'CIKIS' | 'SHIPPED' | 'ALL';

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

export default function MarketplaceOrderPage({
  params,
}: {
  params: Promise<{ code: string; mp: string }>;
}) {
  const { code: rawCode, mp } = use(params);
  const code = rawCode.toUpperCase();
  const sp = useSearchParams();
  const initialStage: Stage =
    sp.get('stage') === 'kargo'
      ? 'KARGO'
      : sp.get('stage') === 'cikis'
      ? 'CIKIS'
      : sp.get('stage') === 'shipped'
      ? 'SHIPPED'
      : 'KARGO';

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [role, setRole] = useState<string>('VIEWER');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(initialStage);
  const [searchTerm, setSearchTerm] = useState('');

  const marketplaceLabel = MARKETPLACE_LABELS[mp] ?? mp;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/depolar/${code}/siparis?marketplaceCode=${encodeURIComponent(mp)}`, {
      credentials: 'include',
    })
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
        logger.error('Sipariş fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, mp]);

  const canCreate = ['PACKER', 'OPERATOR', 'MANAGER', 'ADMIN'].includes(role);

  const counts = {
    kargo: orders.filter((o) => o.status === 'DRAFT' && !o.hasShippingLabel).length,
    cikis: orders.filter((o) => o.status === 'DRAFT' && o.hasShippingLabel).length,
    shipped: orders.filter((o) => o.status === 'SHIPPED').length,
    all: orders.length,
  };

  const filtered = orders.filter((o) => {
    if (stage === 'KARGO' && !(o.status === 'DRAFT' && !o.hasShippingLabel)) return false;
    if (stage === 'CIKIS' && !(o.status === 'DRAFT' && o.hasShippingLabel)) return false;
    if (stage === 'SHIPPED' && o.status !== 'SHIPPED') return false;

    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      (o.description ?? '').toLowerCase().includes(q) ||
      (o.addressNote ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      <Link
        href={`/dashboard/depolar/${code}/siparis`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <ChevronLeft className="w-4 h-4" /> Sipariş Çıkış
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{marketplaceLabel}</h1>
          <p className="text-xs text-gray-500 font-mono">{mp}</p>
        </div>
        {canCreate && (
          <Link
            href={`/dashboard/depolar/${code}/siparis/yeni?type=SINGLE&marketplace=${mp}&returnTo=marketplace`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Yeni Sipariş
          </Link>
        )}
      </div>

      {/* Stage tabs (sayaçlı) */}
      <div className="flex flex-wrap gap-1">
        {([
          { value: 'KARGO',   label: `Kargo (${counts.kargo})`,     cls: 'amber' },
          { value: 'CIKIS',   label: `Çıkış (${counts.cikis})`,     cls: 'blue' },
          { value: 'SHIPPED', label: `Gönderildi (${counts.shipped})`, cls: 'green' },
          { value: 'ALL',     label: `Hepsi (${counts.all})`,       cls: 'gray' },
        ] as { value: Stage; label: string; cls: string }[]).map((s) => (
          <button
            key={s.value}
            onClick={() => setStage(s.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${
              stage === s.value
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s.label}
          </button>
        ))}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Sipariş no / adres"
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
          {orders.length === 0
            ? 'Bu pazaryerinde henüz sipariş yok. Sağ üstten yeni sipariş yarat.'
            : 'Bu sekmede sipariş yok.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Sipariş No</th>
                <th className="text-left px-4 py-2">Adres</th>
                <th className="text-right px-4 py-2">Ürün</th>
                <th className="text-left px-4 py-2">Durum</th>
                <th className="text-left px-4 py-2">Tarih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((o) => (
                <tr key={o.id} className="text-gray-700 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/dashboard/depolar/${code}/siparis/${o.id}`}
                      className="font-mono text-xs text-blue-700 hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600 truncate max-w-[280px]">
                    {o.addressNote ?? o.description ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right">{o.itemCount}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <span
                        className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                          STATUS_BADGE[o.status]
                        }`}
                      >
                        {STATUS_LABEL[o.status]}
                      </span>
                      {o.status === 'DRAFT' && o.hasShippingLabel && (
                        <span
                          className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-700"
                          title="Kargo etiketi yüklendi, çıkış bekliyor"
                        >
                          Etiket ✓
                        </span>
                      )}
                    </div>
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
