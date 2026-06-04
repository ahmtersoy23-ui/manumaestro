/**
 * Somerset (NJ) Pickup sekmesi — koli bazlı çıkış talepleri.
 * Hedef: Amazon US / Amazon Citi (FBA) veya CG Depo. Operatör hedefi seçip
 * pickup yaratır, detayda kolileri ekler, etiket yükler, çıkış yapar.
 * FBA_PICKUP siparişleri yalnız burada görünür (Sipariş Çıkış'tan ayrı).
 * Yalnız NJ; diğer depolarda dashboard'a yönlenir.
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Boxes, Plus, AlertCircle } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { slugToCode, codeToSlug } from '@/lib/warehouseLabels';

const logger = createLogger('PickupTab');

const DEST_LABEL: Record<string, string> = {
  AMZN_US: 'Amazon US (FBA)',
  CUSTOM_01: 'Amazon Citi (FBA)',
  CG_DEPO: 'CG Depo',
};

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  DRAFT: { text: 'Hazırlanıyor', cls: 'bg-amber-100 text-amber-700' },
  SHIPPED: { text: 'Çıktı', cls: 'bg-green-100 text-green-700' },
  CANCELLED: { text: 'İptal', cls: 'bg-gray-100 text-gray-500' },
};

interface PickupOrder {
  id: string;
  marketplaceCode: string;
  orderNumber: string;
  description: string | null;
  status: string;
  itemCount: number;
  hasShippingLabel: boolean;
  createdAt: string;
}

export default function PickupTabPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = slugToCode(rawCode) ?? rawCode.toUpperCase();

  if (code !== 'NJ') {
    redirect(`/dashboard/depolar/${codeToSlug(code)}`);
  }

  const [orders, setOrders] = useState<PickupOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/depolar/${code}/siparis?orderType=FBA_PICKUP`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setOrders(d.data.orders);
        else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('pickup fetch', e);
        setError('Sunucuya bağlanılamadı');
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>;
  if (!orders) return <div className="text-center py-12 text-gray-500">Yükleniyor…</div>;

  // Hedefe göre grupla (iptal edilenler hariç)
  const active = orders.filter((o) => o.status !== 'CANCELLED');
  const destCodes = Array.from(new Set(active.map((o) => o.marketplaceCode)));
  destCodes.sort((a, b) => (DEST_LABEL[a] ?? a).localeCompare(DEST_LABEL[b] ?? b));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Boxes className="w-4 h-4 text-orange-500" />
            Pickup — Koli Bazlı Çıkış
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Hedef: Amazon US / Amazon Citi (FBA) veya CG Depo. Tam koli çıkışı.
          </p>
        </div>
        <Link
          href={`/dashboard/depolar/${codeToSlug(code)}/siparis/yeni?type=FBA_PICKUP`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-orange-500 hover:bg-orange-600 rounded-md"
        >
          <Plus className="w-4 h-4" /> Yeni Pickup
        </Link>
      </div>

      {active.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-10 text-sm text-gray-400 text-center">
          Henüz pickup yok. &quot;Yeni Pickup&quot; ile başla.
        </div>
      ) : (
        destCodes.map((dest) => {
          const rows = active.filter((o) => o.marketplaceCode === dest);
          return (
            <div key={dest} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-700 flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                  {DEST_LABEL[dest] ?? dest}
                </span>
                <span className="text-gray-400">{rows.length} pickup</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-1.5">Pickup ID</th>
                    <th className="text-left px-4 py-1.5">Durum</th>
                    <th className="text-right px-4 py-1.5">Koli</th>
                    <th className="text-left px-4 py-1.5">Etiket</th>
                    <th className="text-left px-4 py-1.5">Oluşturma</th>
                    <th className="px-4 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((o) => {
                    const badge = STATUS_BADGE[o.status] ?? { text: o.status, cls: 'bg-gray-100 text-gray-500' };
                    return (
                      <tr key={o.id} className="text-gray-700 hover:bg-orange-50/40">
                        <td className="px-4 py-2 font-mono text-xs">{o.orderNumber}</td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.text}</span>
                        </td>
                        <td className="px-4 py-2 text-right">{o.itemCount}</td>
                        <td className="px-4 py-2 text-xs">
                          {o.hasShippingLabel ? (
                            <span className="text-green-700">var</span>
                          ) : (
                            <span className="text-gray-400 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> yok
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {new Date(o.createdAt).toLocaleDateString('tr-TR')}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Link
                            href={`/dashboard/depolar/${codeToSlug(code)}/siparis/${o.id}`}
                            className="text-[11px] text-orange-700 hover:underline"
                          >
                            Aç →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}
