'use client';

/**
 * Açılış özet dashboard'u (UI/IA reorg A1.5) — 4 ana grubun başlık metrikleri.
 * Her kart ilgili gruba link. Veri: GET /api/dashboard/overview.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Factory, Boxes, Ship, ShoppingCart, AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react';

interface Overview {
  uretim: { month: string; requests: number; quantity: number; produced: number; groups: Array<{ key: string; label: string; quantity: number }> };
  stok: Array<{ warehouse: string; skus: number; qty: number }>;
  sevkiyat: { planning: number; loading: number; inTransit: number; pendingPools: number };
  siparis: { etiket: number; cikis: number; cg: number; kapatmaBekliyor: number; amazonCancelled: number };
}

const WH_LABEL: Record<string, string> = { ANKARA: 'Ankara', NJ: 'Somerset', SHOWROOM: 'Fairfield', NL: 'Hollanda' };
const whLabel = (w: string) => WH_LABEL[w] ?? w;
const nf = (n: number) => n.toLocaleString('tr-TR');

function Card({ href, icon: Icon, title, accent, children }: {
  href: string; icon: typeof Factory; title: string; accent: string; children: React.ReactNode;
}) {
  return (
    <Link href={href} className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-5 hover:border-gray-300 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-3">
        <span className={`rounded-lg p-2.5 text-white ${accent}`}><Icon className="w-5 h-5" /></span>
        <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
      </div>
      <div className="text-sm font-semibold text-gray-800 mb-1.5">{title}</div>
      <div className="text-gray-700">{children}</div>
    </Link>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/dashboard/overview', { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.error || 'Yüklenemedi');
      setData((json.data ?? json) as Overview);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hata');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const u = data?.uretim;
  const producedPct = u && u.quantity > 0 ? Math.round((u.produced / u.quantity) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Genel Bakış</h1>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* ÜRETİM */}
        <Card href="/dashboard/uretim" icon={Factory} title="Üretim" accent="bg-gray-900">
          {u ? (
            <>
              <div className="text-2xl font-bold text-gray-900">{nf(u.requests)} <span className="text-base font-medium text-gray-500">talep</span></div>
              <div className="text-sm text-gray-500 mt-1">{u.month} · {nf(u.quantity)} adet · %{producedPct} üretildi</div>
              {u.groups?.length > 0 && (
                <ul className="mt-2 pt-2 border-t border-gray-100 space-y-1 text-sm">
                  {u.groups.map((g) => (
                    <li key={g.key} className="flex justify-between gap-2">
                      <span className="text-gray-600">{g.label}</span>
                      <span className="text-gray-900 font-medium">{nf(g.quantity)} adet</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : <div className="text-sm text-gray-400">{loading ? 'Yükleniyor…' : '—'}</div>}
        </Card>

        {/* STOK */}
        <Card href="/dashboard/stok" icon={Boxes} title="Stok" accent="bg-amber-500">
          {data?.stok?.length ? (
            <ul className="space-y-1 text-sm">
              {data.stok.map((s) => (
                <li key={s.warehouse} className="flex justify-between gap-2">
                  <span className="text-gray-600">{whLabel(s.warehouse)}</span>
                  <span className="text-gray-900 font-medium">{nf(s.skus)} çeşit · {nf(s.qty)} adet</span>
                </li>
              ))}
            </ul>
          ) : <div className="text-sm text-gray-400">{loading ? 'Yükleniyor…' : 'Stok yok'}</div>}
        </Card>

        {/* SEVKİYAT */}
        <Card href="/dashboard/shipments" icon={Ship} title="Sevkiyat" accent="bg-sky-600">
          {data ? (
            <>
              <ul className="space-y-1 text-sm">
                {([
                  ['Planlama', data.sevkiyat.planning],
                  ['Yükleme', data.sevkiyat.loading],
                  ['Yolda', data.sevkiyat.inTransit],
                  ['Bekleyen havuz', data.sevkiyat.pendingPools],
                ] as const).map(([label, n]) => (
                  <li key={label} className="flex justify-between gap-2">
                    <span className="text-gray-600">{label}</span>
                    <span className="text-gray-900 font-medium">{nf(n)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : <div className="text-sm text-gray-400">{loading ? 'Yükleniyor…' : '—'}</div>}
        </Card>

        {/* SİPARİŞ */}
        <Card href="/dashboard/siparis" icon={ShoppingCart} title="Sipariş" accent="bg-violet-600">
          {data ? (
            <>
              <ul className="space-y-1 text-sm">
                {([
                  ['Etiket bekliyor', data.siparis.etiket],
                  ['Çıkış bekliyor', data.siparis.cikis],
                  ['CG bekliyor', data.siparis.cg],
                  ['Kapatma bekliyor', data.siparis.kapatmaBekliyor],
                ] as const).map(([label, n]) => (
                  <li key={label} className="flex justify-between gap-2">
                    <span className="text-gray-600">{label}</span>
                    <span className="text-gray-900 font-medium">{nf(n)}</span>
                  </li>
                ))}
              </ul>
              {data.siparis.amazonCancelled > 0 && (
                <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> {nf(data.siparis.amazonCancelled)} Amazon iptal
                </div>
              )}
            </>
          ) : <div className="text-sm text-gray-400">{loading ? 'Yükleniyor…' : '—'}</div>}
        </Card>
      </div>
    </div>
  );
}
