/**
 * Sipariş Çıkış — Stage sayfası (depo geneli).
 * /dashboard/depolar/[code]/siparis/stage/kargo  → kargo etiketi bekleyenler
 * /dashboard/depolar/[code]/siparis/stage/cikis  → çıkış bekleyenler
 *
 * Üretim kategori kartı paterniyle simetrik: lobi'deki sayaç tıklanır,
 * o stage'deki tüm marketplace siparişleri tek tabloda sıralanır.
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ChevronLeft,
  PackageOpen,
  AlertCircle,
  Search,
  Printer,
} from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { slugToCode, codeToSlug } from '@/lib/warehouseLabels';

const logger = createLogger('OutboundStage');

const MARKETPLACE_LABELS: Record<string, string> = {
  AMZN_US: 'Amazon US',
  CUSTOM_01: 'Amazon Citi',
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
  items: { iwasku: string; name: string | null; fnsku: string | null; quantity: number }[];
  hasShippingLabel: boolean;
  createdAt: string;
  shippedAt: string | null;
}

const STAGE_META: Record<
  string,
  { title: string; subtitle: string; emptyMsg: string; accent: string }
> = {
  kargo: {
    title: 'Kargo etiketi bekleyenler',
    subtitle: 'Etiket PDF + tracking yüklenmesi bekleniyor',
    emptyMsg: 'Etiket bekleyen sipariş yok.',
    accent: 'amber',
  },
  cikis: {
    title: 'Çıkış bekleyenler',
    subtitle: 'Etiket hazır, raf seçimi ve sevk bekleniyor',
    emptyMsg: 'Çıkış bekleyen sipariş yok.',
    accent: 'blue',
  },
};

export default function StagePage({
  params,
}: {
  params: Promise<{ code: string; stage: string }>;
}) {
  const { code: rawCode, stage } = use(params);
  const code = slugToCode(rawCode) ?? rawCode.toUpperCase();

  if (!STAGE_META[stage]) {
    redirect(`/dashboard/depolar/${codeToSlug(code)}/siparis`);
  }
  if (code === 'ANKARA') {
    redirect(`/dashboard/depolar/${codeToSlug(code)}`);
  }

  const meta = STAGE_META[stage];

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/depolar/${code}/siparis?status=DRAFT&orderType=SINGLE`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setOrders(d.data.orders);
        else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Stage fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Stage filtresi (label varlığına göre)
  const stageOrders = orders.filter((o) => {
    if (stage === 'kargo') return !o.hasShippingLabel;
    if (stage === 'cikis') return o.hasShippingLabel;
    return true;
  });

  // En eski önce (urgency)
  const sorted = [...stageOrders].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const filtered = sorted.filter((o) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      o.marketplaceCode.toLowerCase().includes(q) ||
      o.items.some(
        (it) =>
          it.iwasku.toLowerCase().includes(q) ||
          (it.name ?? '').toLowerCase().includes(q) ||
          (it.fnsku ?? '').toLowerCase().includes(q)
      ) ||
      (o.description ?? '').toLowerCase().includes(q) ||
      (o.addressNote ?? '').toLowerCase().includes(q)
    );
  });

  const accentBgCls = meta.accent === 'amber' ? 'bg-amber-50' : 'bg-blue-50';
  const accentBorderCls = meta.accent === 'amber' ? 'border-amber-200' : 'border-blue-200';
  const accentTextCls = meta.accent === 'amber' ? 'text-amber-900' : 'text-blue-900';
  const accentSubCls = meta.accent === 'amber' ? 'text-amber-700' : 'text-blue-700';

  return (
    <div className="space-y-5">
      <Link
        href={`/dashboard/depolar/${codeToSlug(code)}/siparis`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <ChevronLeft className="w-4 h-4" /> Sipariş Çıkış
      </Link>

      {/* Başlık */}
      <div className={`rounded-lg border ${accentBorderCls} ${accentBgCls} p-4 flex items-center justify-between`}>
        <div>
          <div className={`text-xs font-medium ${accentSubCls} mb-1`}>{meta.subtitle}</div>
          <div className="flex items-baseline gap-3">
            <h1 className={`text-2xl font-semibold ${accentTextCls}`}>{meta.title}</h1>
            <span className={`text-sm ${accentSubCls}`}>({sorted.length})</span>
          </div>
        </div>
        {stage === 'cikis' && sorted.length > 0 && (
          <a
            href={`/api/depolar/${code}/labels/merge?stage=cikis`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            title="Tüm hazır SHIPPING etiketlerini tek PDF'te indir (her sayfada altta sipariş + ürün bilgisi şeridi)"
          >
            <Printer className="w-4 h-4" /> Hazır Etiketleri Toplu İndir
          </a>
        )}
      </div>

      {/* Arama */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Sipariş no / pazaryeri / ürün"
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
        />
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
          {searchTerm ? 'Aramayla eşleşen sipariş yok.' : meta.emptyMsg}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Pazaryeri</th>
                <th className="text-left px-4 py-2">Sipariş No</th>
                <th className="text-left px-4 py-2">Ürün</th>
                <th className="text-left px-4 py-2">FNSKU</th>
                <th className="text-left px-4 py-2">Tarih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((o) => (
                <tr key={o.id} className="text-gray-700 hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs">
                    <Link
                      href={`/dashboard/depolar/${codeToSlug(code)}/siparis/marketplace/${o.marketplaceCode}`}
                      className="text-gray-700 hover:underline"
                    >
                      {MARKETPLACE_LABELS[o.marketplaceCode] ?? o.marketplaceCode}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/dashboard/depolar/${codeToSlug(code)}/siparis/${o.id}`}
                      className="font-mono text-xs text-blue-700 hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600 max-w-[360px]">
                    {o.items.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {o.items.map((it, idx) => (
                          <div key={idx} className="truncate">
                            <span className="text-gray-800">{it.name ?? it.iwasku}</span>
                            <span className="text-gray-400"> ×{it.quantity}</span>
                            {it.name && (
                              <span className="ml-1.5 font-mono text-[10px] text-gray-400">
                                {it.iwasku}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {o.items.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {o.items.map((it, idx) => (
                          <div key={idx} className="font-mono text-[11px] text-gray-600">
                            {it.fnsku ?? '—'}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {new Date(o.createdAt).toLocaleDateString('tr-TR')}
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
