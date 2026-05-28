/**
 * V2 — Merkezi Üretim Talebi Yönetimi (2026-05-28 revize)
 * Bölge tab + birleşik liste (suggestions + requests) + manuel ekleme + badge sistemi.
 * Detay kanal (2. barem) ileride; MVP destinasyon (1. barem) odaklı.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, X, RefreshCw, Plus, Search } from 'lucide-react';
import { notify } from '@/lib/ui/notify';
import { createLogger } from '@/lib/logger';
import { SuggestionAcceptModal } from '@/components/forms/SuggestionAcceptModal';
import { NewRequestModal } from '@/components/forms/NewRequestModal';
import {
  REGIONS,
  REGION_LABELS,
  DESTINATIONS_BY_REGION,
  type Region,
} from '@/lib/marketplaceRegions';

const logger = createLogger('OnerilerPage');

interface PipelineItem {
  type: 'suggestion' | 'request';
  id: string;
  iwasku: string;
  productName: string;
  productCategory: string;
  productSize: number | null;
  marketplaceId: string;
  marketplaceCode: string;
  marketplaceName: string;
  productionMonth: string;
  quantity: number;
  priority: string | null;
  status: string;
  source: 'AUTO' | 'AUTO_ACCEPTED' | 'MANUAL' | 'EXCEL';
  l30: number;
  l90: number;
  l180: number;
  formulaVersion: string | null;
  reasoning: string | null;
  createdAt: string;
  notes: string | null;
}

interface Marketplace {
  id: string;
  code: string;
  name: string;
  region: string;
}

const DEFAULT_MONTH = '2026-06';

export default function OnerilerPage() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [loading, setLoading] = useState(false);
  const [region, setRegion] = useState<Region>('US');
  const [month, setMonth] = useState<string>(DEFAULT_MONTH);
  const [marketplaceFilter, setMarketplaceFilter] = useState<string>('');
  const [q, setQ] = useState('');
  const [acceptModal, setAcceptModal] = useState<PipelineItem | null>(null);
  const [newRequestOpen, setNewRequestOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('region', region);
      if (month) sp.set('productionMonth', month);
      if (q) sp.set('q', q);
      const res = await fetch(`/api/production-pipeline?${sp}`);
      const data = await res.json();
      if (data.success) setItems(data.data.items);
      else notify.error('Liste yüklenemedi', data.error);
    } catch (err) {
      logger.error('Load error:', err);
      notify.error('Liste yüklenemedi', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMarketplaces = async () => {
    try {
      const res = await fetch('/api/marketplaces');
      const data = await res.json();
      if (data.success) setMarketplaces(data.data);
    } catch (err) {
      logger.error('Marketplaces load error:', err);
    }
  };

  useEffect(() => { loadMarketplaces(); }, []);
  useEffect(() => { load(); }, [region, month, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtre: marketplace dropdown bölgenin destinasyon'larıyla sınırlı
  const regionDestinations = DESTINATIONS_BY_REGION[region];
  const regionMarketplaces = useMemo(
    () => marketplaces.filter(m => regionDestinations.includes(m.code)),
    [marketplaces, regionDestinations],
  );

  // Client-side ek filter: marketplace
  const filtered = useMemo(() => {
    if (!marketplaceFilter) return items;
    return items.filter(i => i.marketplaceId === marketplaceFilter);
  }, [items, marketplaceFilter]);

  const dismiss = async (item: PipelineItem) => {
    if (item.type !== 'suggestion') return;
    if (!confirm('Bu öneriyi reddetmek istediğinize emin misiniz?')) return;
    try {
      const res = await fetch(`/api/production-suggestions/${item.id}/dismiss`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? data.error ?? 'Hata');
      notify.success('Reddedildi');
      load();
    } catch (err) { notify.error('Reddedilemedi', err); }
  };

  const sourceBadge = (source: PipelineItem['source']) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      AUTO:          { bg: 'bg-blue-100',    text: 'text-blue-800',    label: 'AUTO' },
      AUTO_ACCEPTED: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'AUTO ✓' },
      MANUAL:        { bg: 'bg-purple-100',  text: 'text-purple-800',  label: 'MANUEL' },
      EXCEL:         { bg: 'bg-slate-200',   text: 'text-slate-700',   label: 'EXCEL' },
    };
    const cfg = map[source];
    return <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>;
  };

  const statusBadge = (item: PipelineItem) => {
    if (item.type === 'suggestion') {
      return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">Bekliyor</span>;
    }
    const map: Record<string, { bg: string; text: string; label: string }> = {
      REQUESTED:          { bg: 'bg-sky-100',   text: 'text-sky-800',   label: 'Talep' },
      IN_PRODUCTION:      { bg: 'bg-indigo-100',text: 'text-indigo-800',label: 'Üretimde' },
      PARTIALLY_PRODUCED: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Kısmi' },
      COMPLETED:          { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Tamam' },
      CANCELLED:          { bg: 'bg-slate-200', text: 'text-slate-600', label: 'İptal' },
    };
    const cfg = map[item.status] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: item.status };
    return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>;
  };

  // Destinasyon grup başlığı — items'i destinasyon'a göre gruplandır
  const grouped = useMemo(() => {
    const map = new Map<string, PipelineItem[]>();
    filtered.forEach(item => {
      const code = item.marketplaceCode;
      if (!map.has(code)) map.set(code, []);
      map.get(code)!.push(item);
    });
    // Region destination sırasıyla
    return regionDestinations
      .filter(code => map.has(code))
      .map(code => ({ code, items: map.get(code)! }));
  }, [filtered, regionDestinations]);

  const totals = useMemo(() => ({
    items: filtered.length,
    pendingQty: filtered.filter(i => i.type === 'suggestion').reduce((s, i) => s + i.quantity, 0),
    requestQty: filtered.filter(i => i.type === 'request').reduce((s, i) => s + i.quantity, 0),
  }), [filtered]);

  return (
    <div className="p-6 max-w-[1800px] mx-auto space-y-4">
      {/* Header banner */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-purple-900">Talep Girişi V2 — Merkezi Üretim Talebi</h1>
          <p className="text-xs text-purple-700">
            StockPulse otomatik önerileri (AUTO) + manuel/excel girişler (MANUEL) tek yerde. Bölge × destinasyon yapısı StockPulse replenishment ile aynı.
          </p>
        </div>
        <button
          onClick={() => setNewRequestOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
        >
          <Plus className="w-4 h-4" /> Yeni Talep
        </button>
      </div>

      {/* Region tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {REGIONS.map(r => (
          <button
            key={r}
            onClick={() => { setRegion(r); setMarketplaceFilter(''); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              region === r
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {REGION_LABELS[r]}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded p-3">
          <p className="text-[10px] text-slate-500 uppercase">Toplam Satır</p>
          <p className="text-xl font-bold text-slate-900">{totals.items}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3">
          <p className="text-[10px] text-slate-500 uppercase">Bekleyen Adet (öneri)</p>
          <p className="text-xl font-bold text-blue-700">{totals.pendingQty.toLocaleString('tr-TR')}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3">
          <p className="text-[10px] text-slate-500 uppercase">Açık Talep Adet</p>
          <p className="text-xl font-bold text-emerald-700">{totals.requestQty.toLocaleString('tr-TR')}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Üretim Ayı</label>
          <input value={month} onChange={e => setMonth(e.target.value)} placeholder="2026-06"
            className="px-3 py-1.5 border border-slate-300 rounded text-sm w-28" />
        </div>
        <div>
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Destinasyon</label>
          <select value={marketplaceFilter} onChange={e => setMarketplaceFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded text-sm w-56">
            <option value="">Tümü ({REGION_LABELS[region]})</option>
            {regionMarketplaces.map(m => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Ara</label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="iwasku veya ürün adı..."
              className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded text-sm" />
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 border border-slate-300 rounded text-sm flex items-center gap-1 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>

      {/* Table — grouped by destination */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-xs">IWASKU</th>
                <th className="px-3 py-2 text-left font-medium text-xs">Ürün</th>
                <th className="px-3 py-2 text-left font-medium text-xs">Kategori</th>
                <th className="px-3 py-2 text-right font-medium text-xs">Desi</th>
                <th className="px-3 py-2 text-right font-medium text-xs">Miktar</th>
                <th className="px-3 py-2 text-right font-medium text-xs">L30</th>
                <th className="px-3 py-2 text-right font-medium text-xs">L90</th>
                <th className="px-3 py-2 text-right font-medium text-xs">L180</th>
                <th className="px-3 py-2 text-center font-medium text-xs">Ay</th>
                <th className="px-3 py-2 text-center font-medium text-xs">Source</th>
                <th className="px-3 py-2 text-center font-medium text-xs">Durum</th>
                <th className="px-3 py-2 text-center font-medium text-xs">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 && !loading && (
                <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-400">
                  {REGION_LABELS[region]} bölgesinde {month} için talep/öneri yok
                </td></tr>
              )}
              {grouped.map(group => {
                const mp = marketplaces.find(m => m.code === group.code);
                return (
                  <>
                    {/* Destinasyon başlık satırı */}
                    <tr key={`hdr-${group.code}`} className="bg-slate-100/80 border-y border-slate-300">
                      <td colSpan={12} className="px-3 py-2 font-semibold text-slate-800 text-sm">
                        🚚 {mp?.name ?? group.code} <span className="text-slate-500 font-normal text-xs">({group.code}) — {group.items.length} satır</span>
                      </td>
                    </tr>
                    {/* Satırlar */}
                    {group.items.map(item => (
                      <tr key={`${item.type}-${item.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-1.5 font-mono text-xs text-cyan-700">{item.iwasku}</td>
                        <td className="px-3 py-1.5 max-w-[240px] truncate text-xs" title={item.productName}>{item.productName}</td>
                        <td className="px-3 py-1.5 text-slate-600 text-xs">{item.productCategory}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums">{item.productSize?.toFixed(2) ?? '-'}</td>
                        <td className="px-3 py-1.5 text-right text-sm font-bold text-blue-700 tabular-nums">{item.quantity.toLocaleString('tr-TR')}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-600">{item.l30 || '-'}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-600">{item.l90 || '-'}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-600">{item.l180 || '-'}</td>
                        <td className="px-3 py-1.5 text-center text-xs text-slate-500">{item.productionMonth}</td>
                        <td className="px-3 py-1.5 text-center">{sourceBadge(item.source)}</td>
                        <td className="px-3 py-1.5 text-center">{statusBadge(item)}</td>
                        <td className="px-3 py-1.5 text-center">
                          {item.type === 'suggestion' && item.status === 'PENDING' && (
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => setAcceptModal(item)}
                                className="px-2 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 flex items-center gap-1">
                                <Check className="w-3 h-3" /> Kabul
                              </button>
                              <button onClick={() => dismiss(item)}
                                className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs hover:bg-slate-200 flex items-center gap-1">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {acceptModal && acceptModal.type === 'suggestion' && (
        <SuggestionAcceptModal
          suggestion={{
            id: acceptModal.id,
            iwasku: acceptModal.iwasku,
            productName: acceptModal.productName,
            productCategory: acceptModal.productCategory,
            productionMonth: acceptModal.productionMonth,
            suggestedQty: acceptModal.quantity,
            formulaVersion: acceptModal.formulaVersion ?? 'v1',
            reasoning: acceptModal.reasoning,
            marketplace: {
              id: acceptModal.marketplaceId,
              code: acceptModal.marketplaceCode,
              name: acceptModal.marketplaceName,
              region: '',
            },
          }}
          onClose={() => setAcceptModal(null)}
          onSuccess={() => { setAcceptModal(null); load(); }}
        />
      )}

      {newRequestOpen && (
        <NewRequestModal
          defaultRegion={region}
          marketplaces={regionMarketplaces}
          onClose={() => setNewRequestOpen(false)}
          onSuccess={() => { setNewRequestOpen(false); load(); }}
        />
      )}
    </div>
  );
}
