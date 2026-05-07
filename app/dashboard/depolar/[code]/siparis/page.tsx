/**
 * Sipariş Çıkış — Lobi sayfası.
 * Üstte işlem kartı (kargo + çıkış sayaçları, depo geneli),
 * altta 6 US pazaryeri kartı → her biri marketplace alt sayfasına link.
 * Tek liste yerine marketplace bazlı alt sayfalar üzerinden ilerleme.
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ClipboardList, Truck, AlertCircle } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { slugToCode, codeToSlug } from '@/lib/warehouseLabels';

const logger = createLogger('OutboundLobby');

const US_MARKETPLACES = [
  { code: 'AMZN_US',    label: 'Amazon US' },
  { code: 'WAYFAIR_US', label: 'Wayfair US' },
  { code: 'CUSTOM_05',  label: 'Walmart' },
  { code: 'CUSTOM_04',  label: 'eBay' },
  { code: 'CUSTOM_03',  label: 'Etsy' },
  { code: 'CUSTOM_07',  label: 'Shopify' },
];

interface MarketplaceStats {
  marketplaceCode: string;
  kargoBekleyen: number;
  cikisBekleyen: number;
  shipped: number;
}

interface LobbyData {
  role: string;
  totals: { kargoBekleyen: number; cikisBekleyen: number };
  byMarketplace: MarketplaceStats[];
  access: { allMarketplaces: boolean; viewable: string[]; editable: string[] };
}

export default function SiparisLobbyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = slugToCode(rawCode) ?? rawCode.toUpperCase();

  if (code === 'ANKARA') {
    redirect(`/dashboard/depolar/${codeToSlug(code)}`);
  }

  const [data, setData] = useState<LobbyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/depolar/${code}/siparis/lobby`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setData(d.data);
        else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Lobby fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Sipariş Çıkış</h1>
          <p className="text-xs text-gray-500">
            Pazaryeri seçerek talepleri gir ve takip et.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {loading && <div className="text-center py-12 text-gray-500">Yükleniyor…</div>}

      {data && (
        <>
          {/* İşlem kartı — depo geneli (her bölüm clickable, kendi alt sayfasına) */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
              <ClipboardList className="w-4 h-4" /> İşlem (depo geneli)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link
                href={`/dashboard/depolar/${codeToSlug(code)}/siparis/stage/kargo`}
                className="block rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 p-4 transition-colors"
              >
                <div className="text-xs font-medium text-amber-800 mb-1">
                  Kargo etiketi bekleyen
                </div>
                <p className="text-3xl font-semibold text-amber-900">
                  {data.totals.kargoBekleyen}
                </p>
                <p className="text-[11px] text-amber-700 mt-1">
                  PDF + tracking yüklenecek
                </p>
              </Link>
              <Link
                href={`/dashboard/depolar/${codeToSlug(code)}/siparis/stage/cikis`}
                className="block rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 p-4 transition-colors"
              >
                <div className="text-xs font-medium text-blue-800 mb-1">Çıkış bekleyen</div>
                <p className="text-3xl font-semibold text-blue-900">
                  {data.totals.cikisBekleyen}
                </p>
                <p className="text-[11px] text-blue-700 mt-1">
                  Etiket hazır, sevk bekleniyor
                </p>
              </Link>
            </div>
          </div>

          {/* Pazaryeri kartları — sadece kullanıcının canView yetkisi olanlar */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
              <Truck className="w-4 h-4" /> Pazaryerleri
            </div>
            {(() => {
              const visible = US_MARKETPLACES.filter(
                (m) => data.access.allMarketplaces || data.access.viewable.includes(m.code)
              );
              if (visible.length === 0) {
                return (
                  <div className="px-3 py-6 text-sm text-gray-400 text-center">
                    Yetkili olduğun pazaryeri yok. İzin Yönetimi → Pazar Yeri İzinleri&apos;ne bak.
                  </div>
                );
              }
              return null;
            })()}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {US_MARKETPLACES.filter(
                (m) => data.access.allMarketplaces || data.access.viewable.includes(m.code)
              ).map((m) => {
                const stats = data.byMarketplace.find((s) => s.marketplaceCode === m.code) ?? {
                  marketplaceCode: m.code,
                  kargoBekleyen: 0,
                  cikisBekleyen: 0,
                  shipped: 0,
                };
                return (
                  <Link
                    key={m.code}
                    href={`/dashboard/depolar/${codeToSlug(code)}/siparis/marketplace/${m.code}`}
                    className="block rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 p-4 transition-colors"
                  >
                    <div className="text-sm font-medium text-gray-900 mb-2">{m.label}</div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-lg font-semibold text-amber-700">
                          {stats.kargoBekleyen}
                        </p>
                        <p className="text-[10px] text-gray-500">Kargo</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-blue-700">
                          {stats.cikisBekleyen}
                        </p>
                        <p className="text-[10px] text-gray-500">Çıkış</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-gray-700">{stats.shipped}</p>
                        <p className="text-[10px] text-gray-500">Gönd.</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
