/**
 * Üretim Önerileri (V2 Pilot — Haziran 2026)
 * StockPulse'tan otomatik gelen önerileri listele, tek tıkla
 * ProductionRequest'e dönüştür. Mevcut manuel akış paralel çalışır.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, X, RefreshCw, Package } from 'lucide-react';
import { notify } from '@/lib/ui/notify';
import { createLogger } from '@/lib/logger';
import { SuggestionAcceptModal } from '@/components/forms/SuggestionAcceptModal';

const logger = createLogger('OnerilerPage');

interface MarketplaceMini {
  id: string;
  name: string;
  code: string;
  region: string;
}

interface Suggestion {
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  productSize: number | null;
  marketplaceId: string;
  productionMonth: string;
  suggestedQty: number;
  formulaVersion: string;
  reasoning: string | null;
  l30: number;
  l90: number;
  l180: number;
  status: 'PENDING' | 'ACCEPTED' | 'DISMISSED' | 'EXPIRED';
  syncedAt: string;
  decidedAt: string | null;
  marketplace: MarketplaceMini;
}

const DEFAULT_MONTH = '2026-06'; // Pilot

export default function OnerilerPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState<string>(DEFAULT_MONTH);
  const [marketplaceFilter, setMarketplaceFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [q, setQ] = useState('');
  const [acceptModal, setAcceptModal] = useState<Suggestion | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (month) sp.set('productionMonth', month);
      if (marketplaceFilter) sp.set('marketplaceId', marketplaceFilter);
      if (categoryFilter) sp.set('category', categoryFilter);
      if (statusFilter) sp.set('status', statusFilter);
      if (q) sp.set('q', q);
      const res = await fetch(`/api/production-suggestions?${sp}`);
      const data = await res.json();
      if (data.success) setSuggestions(data.data.suggestions);
      else notify.error('Öneriler yüklenemedi', data.error);
    } catch (err) {
      logger.error('Load error:', err);
      notify.error('Öneriler yüklenemedi', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month, marketplaceFilter, categoryFilter, statusFilter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const { categories, marketplaces } = useMemo(() => {
    const cats = new Set<string>();
    const mps = new Map<string, MarketplaceMini>();
    suggestions.forEach(s => {
      if (s.productCategory) cats.add(s.productCategory);
      if (s.marketplace) mps.set(s.marketplace.id, s.marketplace);
    });
    return { categories: [...cats].sort(), marketplaces: [...mps.values()].sort((a, b) => a.code.localeCompare(b.code)) };
  }, [suggestions]);

  const totals = useMemo(() => {
    const pending = suggestions.filter(s => s.status === 'PENDING');
    return {
      pendingCount: pending.length,
      pendingQty: pending.reduce((sum, s) => sum + s.suggestedQty, 0),
      pendingDesi: Math.round(pending.reduce((sum, s) => sum + (s.productSize ?? 0) * s.suggestedQty, 0)),
    };
  }, [suggestions]);

  const dismiss = async (id: string) => {
    if (!confirm('Bu öneriyi reddetmek istediğinize emin misiniz?')) return;
    try {
      const res = await fetch(`/api/production-suggestions/${id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? data.error ?? 'Hata');
      notify.success('Reddedildi');
      load();
    } catch (err) {
      notify.error('Reddedilemedi', err);
    }
  };

  const statusBadge = (s: Suggestion['status']) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      PENDING:   { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'Bekliyor' },
      ACCEPTED:  { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Kabul Edildi' },
      DISMISSED: { bg: 'bg-slate-200',   text: 'text-slate-700',   label: 'Reddedildi' },
      EXPIRED:   { bg: 'bg-rose-100',    text: 'text-rose-800',    label: 'Süresi Doldu' },
    };
    const cfg = map[s];
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>;
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <h1 className="text-xl font-bold text-purple-900 flex items-center gap-2">
          <Package className="w-5 h-5" /> Talep Girişi V2 — Otomatik Öneri (Pilot)
        </h1>
        <p className="text-sm text-purple-800 mt-1">
          StockPulse&apos;tan günlük gelen üretim önerileri. Mevcut Manuel Talep Girişi sayfası dokunulmadı; bu sayfa <b>paralel</b> çalışıyor.
          Pilot ayı: <b>Haziran 2026</b>. Kabul ettiğin her öneri otomatik <code>ProductionRequest</code> oluşturur (entryType: STOCKPULSE).
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500 uppercase">Bekleyen Öneri</p>
          <p className="text-2xl font-bold text-amber-700">{totals.pendingCount}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500 uppercase">Bekleyen Adet</p>
          <p className="text-2xl font-bold text-slate-900">{totals.pendingQty.toLocaleString('tr-TR')}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500 uppercase">Bekleyen Desi</p>
          <p className="text-2xl font-bold text-emerald-700">{totals.pendingDesi.toLocaleString('tr-TR')}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Ay</label>
          <input value={month} onChange={e => setMonth(e.target.value)} placeholder="2026-06"
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-32" />
        </div>
        <div>
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Marketplace</label>
          <select value={marketplaceFilter} onChange={e => setMarketplaceFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-48">
            <option value="">Tümü</option>
            {marketplaces.map(m => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Kategori</label>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-40">
            <option value="">Tümü</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Durum</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-36">
            <option value="">Tümü</option>
            <option value="PENDING">Bekleyen</option>
            <option value="ACCEPTED">Kabul Edilen</option>
            <option value="DISMISSED">Reddedilen</option>
            <option value="EXPIRED">Süresi Dolan</option>
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Ara</label>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="iwasku veya ürün adı..."
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm flex items-center gap-1 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-xs">IWASKU</th>
                <th className="px-3 py-2 text-left font-medium text-xs">Ürün</th>
                <th className="px-3 py-2 text-left font-medium text-xs">Kategori</th>
                <th className="px-3 py-2 text-right font-medium text-xs">Desi</th>
                <th className="px-3 py-2 text-center font-medium text-xs">Marketplace</th>
                <th className="px-3 py-2 text-center font-medium text-xs">Ay</th>
                <th className="px-3 py-2 text-right font-medium text-xs">Önerilen</th>
                <th className="px-3 py-2 text-right font-medium text-xs">L30</th>
                <th className="px-3 py-2 text-right font-medium text-xs">L90</th>
                <th className="px-3 py-2 text-right font-medium text-xs">L180</th>
                <th className="px-3 py-2 text-center font-medium text-xs">Model</th>
                <th className="px-3 py-2 text-center font-medium text-xs">Durum</th>
                <th className="px-3 py-2 text-center font-medium text-xs">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.length === 0 && !loading && (
                <tr><td colSpan={13} className="px-3 py-8 text-center text-slate-400">Öneri yok</td></tr>
              )}
              {suggestions.map(s => (
                <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs text-cyan-700">{s.iwasku}</td>
                  <td className="px-3 py-2 max-w-[260px] truncate" title={s.productName}>{s.productName}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs">{s.productCategory}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">{s.productSize?.toFixed(2) ?? '-'}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">{s.marketplace.code}</span>
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-slate-500">{s.productionMonth}</td>
                  <td className="px-3 py-2 text-right font-bold text-blue-700 tabular-nums">{s.suggestedQty.toLocaleString('tr-TR')}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">{s.l30}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">{s.l90}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">{s.l180}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                        s.formulaVersion === 'v4D' ? 'bg-rose-100 text-rose-700'
                        : s.formulaVersion === 'v4' ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                      }`}
                      title={s.reasoning ?? ''}
                    >{s.formulaVersion}</span>
                  </td>
                  <td className="px-3 py-2 text-center">{statusBadge(s.status)}</td>
                  <td className="px-3 py-2 text-center">
                    {(s.status === 'PENDING' || s.status === 'EXPIRED') && (
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => setAcceptModal(s)}
                          className="px-2 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 flex items-center gap-1">
                          <Check className="w-3 h-3" /> Kabul
                        </button>
                        <button onClick={() => dismiss(s.id)}
                          className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs hover:bg-slate-200 flex items-center gap-1">
                          <X className="w-3 h-3" /> Reddet
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {acceptModal && (
        <SuggestionAcceptModal
          suggestion={acceptModal}
          onClose={() => setAcceptModal(null)}
          onSuccess={() => { setAcceptModal(null); load(); }}
        />
      )}
    </div>
  );
}
