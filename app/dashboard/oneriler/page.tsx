/**
 * V2 — Merkezi Üretim Talebi (2026-05-28 → Faz 1.1d revize)
 *
 * Ay bazlı görünüm, mevcut Month detail layout'una uyumlu:
 *  - Üst: ay seçim + Adet/Desi toggle + Toplam Talep/Miktar + üretici grup özetleri
 *  - 🤖 StockPulse Önerileri (PENDING) — collapsible panel, ay sonu freeze tetikleyiciyle birlikte
 *  - 📦 Kategoriye Göre Üretim (IWA Fabrika / CİTİ Mobilya / Hazır Alım gruplu)
 *  - 🛒 Pazar Yerleri (Bölge → Destinasyon → Pazar yeri hiyerarşik)
 *
 * Mevcut /dashboard/month/[month] sayfası dokunulmadı (paralel kalır).
 * "Ay Kilitle ve Freeze" Faz 1.1d.2'de backend ile etkinleştirilecek.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Calendar, Package, ShoppingCart, Factory, Plus, ChevronDown,
  Hammer, Sofa, ShoppingBag, Bot, Check, X, Lock, RefreshCw,
} from 'lucide-react';
import { notify } from '@/lib/ui/notify';
import { createLogger } from '@/lib/logger';
import { getActiveMonths, parseMonthValue, formatMonthDisplay } from '@/lib/monthUtils';
import { SuggestionAcceptModal } from '@/components/forms/SuggestionAcceptModal';
import { NewRequestModal } from '@/components/forms/NewRequestModal';
import {
  REGIONS, REGION_LABELS, DESTINATIONS_BY_REGION,
  DETAIL_CHANNELS_BY_DESTINATION,
  type Region,
} from '@/lib/marketplaceRegions';

const logger = createLogger('OnerilerV2');

const HAZIR_ALIM_CATEGORIES = ['Alsat', 'Tekstil'];
const MOBILYA_CATEGORIES = ['Mobilya'];

type ProductionGroup = 'fabrika' | 'mobilya' | 'hazirAlim';

function getProductionGroup(categoryName: string): ProductionGroup {
  if (HAZIR_ALIM_CATEGORIES.includes(categoryName)) return 'hazirAlim';
  if (MOBILYA_CATEGORIES.includes(categoryName)) return 'mobilya';
  return 'fabrika';
}

const PRODUCTION_GROUPS = [
  { key: 'fabrika' as const, label: 'IWA Fabrika', icon: Hammer, color: 'rose' },
  { key: 'mobilya' as const, label: 'CİTİ Mobilya', icon: Sofa, color: 'sky' },
  { key: 'hazirAlim' as const, label: 'Hazır Alım', icon: ShoppingBag, color: 'teal' },
];

interface CategorySummary {
  productCategory: string;
  totalQuantity: number;
  totalProduced: number;
  totalDesi: number;
  producedDesi: number;
  requestCount: number;
  itemsWithoutSize: number;
}

interface MarketplaceSummary {
  marketplaceId: string;
  marketplaceName: string;
  totalQuantity: number;
  totalDesi: number;
  requestCount: number;
  completedCount: number;
  completedQty: number;
  completedDesi: number;
}

interface MarketplaceMeta {
  id: string;
  code: string;
  name: string;
  region: string;
}

interface Suggestion {
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
  source: string;
  l30: number; l90: number; l180: number;
  formulaVersion: string | null;
  reasoning: string | null;
}

export default function OnerilerV2Page() {
  const [month, setMonth] = useState<string>('2026-06');
  const [availableMonths, setAvailableMonths] = useState<Array<{ value: string; label: string; locked: boolean }>>([]);
  const [viewMode, setViewMode] = useState<'quantity' | 'desi'>('quantity');
  const [loading, setLoading] = useState(true);

  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [marketplaceSummary, setMarketplaceSummary] = useState<MarketplaceSummary[]>([]);
  const [allMarketplaces, setAllMarketplaces] = useState<MarketplaceMeta[]>([]);
  const [monthStats, setMonthStats] = useState({ totalRequests: 0, totalQuantity: 0, totalDesi: 0 });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const [acceptModal, setAcceptModal] = useState<Suggestion | null>(null);
  const [newRequestRegion, setNewRequestRegion] = useState<Region | null>(null);
  const [openSuggestionsPanel, setOpenSuggestionsPanel] = useState(true);

  useEffect(() => {
    const months = getActiveMonths();
    setAvailableMonths(months);
    if (!months.some(m => m.value === month) && months.length > 0) {
      setMonth(months[0].value);
    }
  }, [month]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [mpRes, monthlyRes, suggRes] = await Promise.all([
        fetch('/api/marketplaces?limit=200'),
        fetch(`/api/requests/monthly?month=${month}`),
        fetch(`/api/production-pipeline?productionMonth=${month}`),
      ]);
      const [mp, monthly, sugg] = await Promise.all([mpRes.json(), monthlyRes.json(), suggRes.json()]);

      if (mp.success) setAllMarketplaces(mp.data);
      if (monthly.success) {
        setCategories((monthly.data.summary || []).sort((a: CategorySummary, b: CategorySummary) => b.totalQuantity - a.totalQuantity));
        setMarketplaceSummary(monthly.data.marketplaceSummary || []);
        setMonthStats({
          totalRequests: monthly.data.totalRequests || 0,
          totalQuantity: monthly.data.totalQuantity || 0,
          totalDesi: monthly.data.totalDesi || 0,
        });
      }
      if (sugg.success) {
        // Sadece PENDING suggestion'ları al (panelde göster)
        setSuggestions((sugg.data.items || []).filter((i: Suggestion) => i.source === 'AUTO'));
      }
    } catch (err) {
      logger.error('Load error:', err);
      notify.error('Veriler yüklenemedi', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const getMpSummary = (mpId: string) => marketplaceSummary.find(s => s.marketplaceId === mpId);

  // Üretici grup özetleri
  const groupTotals = useMemo(() => {
    return PRODUCTION_GROUPS.map(group => {
      const groupCats = categories.filter(c => getProductionGroup(c.productCategory) === group.key);
      const totalQty = groupCats.reduce((s, c) => s + c.totalQuantity, 0);
      const totalDesi = groupCats.reduce((s, c) => s + c.totalDesi, 0);
      return { ...group, cats: groupCats, totalQty, totalDesi };
    }).filter(g => g.totalQty > 0 || g.totalDesi > 0);
  }, [categories]);

  const dismissSuggestion = async (id: string) => {
    if (!confirm('Öneri reddedilsin mi?')) return;
    try {
      const res = await fetch(`/api/production-suggestions/${id}/dismiss`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? data.error ?? 'Hata');
      notify.success('Reddedildi');
      loadAll();
    } catch (err) { notify.error('Reddedilemedi', err); }
  };

  const monthLabel = useMemo(() => {
    try {
      return parseMonthValue(month).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    } catch { return month; }
  }, [month]);

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-6">
      {/* Header: Ay seçim + Toplam Talep/Miktar + üretici grup özetleri */}
      <div className="bg-gradient-to-b from-slate-50 to-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <Calendar className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{monthLabel}</h1>
              <p className="text-xs text-purple-600 font-medium">Talep Girişi V2 — Merkezi Üretim Talebi</p>
            </div>
            <select value={month} onChange={e => setMonth(e.target.value)}
              className="ml-3 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
              {availableMonths.map(m => (
                <option key={m.value} value={m.value}>
                  {formatMonthDisplay(m.value)} {m.locked ? '🔒' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => notify.info('Ay Kilitle özelliği Faz 1.1d.2\'de aktif olacak')}
              disabled
              className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-500 cursor-not-allowed bg-slate-50"
              title="Yakında"
            >
              <Lock className="w-3.5 h-3.5" /> Ay Kilitle & Freeze
            </button>
            <button onClick={loadAll} disabled={loading}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 flex items-center gap-1">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
            </button>
            <div className="flex items-center gap-1 bg-slate-200 rounded-lg p-1">
              <button onClick={() => setViewMode('quantity')}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  viewMode === 'quantity' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>Adet</button>
              <button onClick={() => setViewMode('desi')}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  viewMode === 'desi' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>Desi</button>
            </div>
          </div>
        </div>

        {/* Toplam Talep + Toplam Miktar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-5 border-2 border-slate-300 text-center">
            <p className="text-slate-900 text-xs font-bold uppercase tracking-wider mb-2">Toplam Talep</p>
            <p className="text-4xl font-black text-slate-900 tabular-nums">{monthStats.totalRequests}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border-2 border-slate-300 text-center">
            <p className="text-slate-900 text-xs font-bold uppercase tracking-wider mb-2">Toplam {viewMode === 'quantity' ? 'Miktar' : 'Desi'}</p>
            <p className="text-4xl font-black text-slate-900 tabular-nums">
              {viewMode === 'quantity'
                ? monthStats.totalQuantity.toLocaleString('tr-TR')
                : Math.round(monthStats.totalDesi).toLocaleString('tr-TR')}
            </p>
          </div>
        </div>

        {/* Üretici grup özetleri */}
        {groupTotals.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
            {groupTotals.map(g => {
              const colorMap: Record<string, { bg: string; border: string; text: string; sub: string }> = {
                rose: { bg: 'bg-rose-100', border: 'border-rose-300', text: 'text-rose-800', sub: 'text-rose-500' },
                sky:  { bg: 'bg-sky-100',  border: 'border-sky-300',  text: 'text-sky-800',  sub: 'text-sky-500' },
                teal: { bg: 'bg-teal-100', border: 'border-teal-300', text: 'text-teal-800', sub: 'text-teal-500' },
              };
              const c = colorMap[g.color];
              const displayValue = viewMode === 'quantity' ? g.totalQty : Math.round(g.totalDesi);
              return (
                <div key={g.key} className={`${c.bg} ${c.border} border rounded-xl p-4 text-center`}>
                  <p className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 ${c.text}`}>{g.label}</p>
                  <p className={`text-2xl font-black tabular-nums ${c.text}`}>{displayValue.toLocaleString('tr-TR')}</p>
                  <p className={`text-[11px] ${c.sub} mt-0.5`}>{viewMode === 'quantity' ? 'adet' : 'desi'}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 🤖 StockPulse Önerileri panel */}
      <div className="bg-white rounded-xl border-2 border-blue-200 overflow-hidden">
        <button
          onClick={() => setOpenSuggestionsPanel(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3 bg-blue-50 hover:bg-blue-100 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-blue-600" />
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-900">StockPulse Önerileri</p>
              <p className="text-xs text-slate-500">
                {suggestions.length} bekleyen öneri · {monthLabel} ayı için
              </p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${openSuggestionsPanel ? 'rotate-180' : ''}`} />
        </button>
        {openSuggestionsPanel && (
          <div className="max-h-80 overflow-y-auto">
            {suggestions.length === 0 ? (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">
                Bekleyen öneri yok. Snapshot job ertesi gün UTC 04:00&apos;da çalışır.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium">IWASKU</th>
                    <th className="px-3 py-2 text-left text-xs font-medium">Ürün</th>
                    <th className="px-3 py-2 text-left text-xs font-medium">Pazar Yeri</th>
                    <th className="px-3 py-2 text-right text-xs font-medium">Öneri</th>
                    <th className="px-3 py-2 text-right text-xs font-medium">L30</th>
                    <th className="px-3 py-2 text-right text-xs font-medium">L90</th>
                    <th className="px-3 py-2 text-center text-xs font-medium">Model</th>
                    <th className="px-3 py-2 text-center text-xs font-medium">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map(s => (
                    <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-mono text-xs text-cyan-700">{s.iwasku}</td>
                      <td className="px-3 py-1.5 text-xs max-w-[200px] truncate" title={s.productName}>{s.productName}</td>
                      <td className="px-3 py-1.5 text-xs"><span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">{s.marketplaceCode}</span></td>
                      <td className="px-3 py-1.5 text-right text-sm font-bold text-blue-700 tabular-nums">{s.quantity}</td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-600">{s.l30 || '-'}</td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-600">{s.l90 || '-'}</td>
                      <td className="px-3 py-1.5 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                          s.formulaVersion === 'v4D' ? 'bg-rose-100 text-rose-700' :
                          s.formulaVersion === 'v4' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-slate-100 text-slate-600'
                        }`} title={s.reasoning ?? ''}>{s.formulaVersion ?? 'v1'}</span>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => setAcceptModal(s)}
                            className="px-2 py-0.5 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 flex items-center gap-1">
                            <Check className="w-3 h-3" />
                          </button>
                          <button onClick={() => dismissSuggestion(s.id)}
                            className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs hover:bg-slate-200">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* 📦 Kategoriye Göre Üretim */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Factory className="w-6 h-6 text-slate-700" />
          <h2 className="text-xl font-semibold text-slate-900">Kategoriye Göre Üretim</h2>
        </div>
        {categories.length === 0 ? (
          <div className="bg-slate-50 rounded-xl border-2 border-dashed border-slate-300 p-8 text-center text-slate-500 text-sm">
            Bu ay için üretim talebi yok
          </div>
        ) : (
          <div className="space-y-6">
            {groupTotals.map(group => {
              const Icon = group.icon;
              const colorMap: Record<string, { bg: string; text: string; border: string; value: string }> = {
                rose: { bg: 'bg-rose-100',  text: 'text-rose-600',  border: 'hover:border-rose-400',  value: 'text-rose-600' },
                sky:  { bg: 'bg-sky-100',   text: 'text-sky-600',   border: 'hover:border-sky-400',   value: 'text-sky-600' },
                teal: { bg: 'bg-teal-100',  text: 'text-teal-600',  border: 'hover:border-teal-400',  value: 'text-teal-600' },
              };
              const c = colorMap[group.color];
              return (
                <div key={group.key}>
                  <div className="flex items-center gap-2 mb-3">
                    <Icon className={`w-5 h-5 ${c.text}`} />
                    <h3 className="text-lg font-semibold text-slate-800">{group.label}</h3>
                    <span className="text-xs text-slate-500">({group.cats.length} kategori)</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {group.cats.map(cat => (
                      <Link key={cat.productCategory}
                        href={`/dashboard/manufacturer/${encodeURIComponent(cat.productCategory)}?month=${month}`}
                        className={`block p-4 bg-white rounded-xl border-2 border-slate-200 ${c.border} hover:shadow-md transition-all`}>
                        <div className="flex items-center gap-2 mb-3">
                          <div className={`p-1.5 ${c.bg} rounded-lg`}>
                            <Package className={`w-4 h-4 ${c.text}`} />
                          </div>
                          <h4 className="text-sm font-semibold text-slate-900">{cat.productCategory}</h4>
                        </div>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between"><span className="text-slate-500">Ürün</span><span className="font-bold text-slate-900">{cat.requestCount}</span></div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Talep Edilen</span>
                            <span className={`font-bold ${c.value}`}>
                              {viewMode === 'quantity' ? `${cat.totalQuantity} adet` : `${Math.round(cat.totalDesi)} desi`}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Üretilen</span>
                            <span className="font-bold text-slate-900">
                              {viewMode === 'quantity' ? `${cat.totalProduced} adet` : `${Math.round(cat.producedDesi)} desi`}
                            </span>
                          </div>
                          {cat.totalQuantity > 0 && (
                            <div className="mt-2 pt-2 border-t border-slate-100">
                              <div className="flex justify-between text-[10px] text-slate-500">
                                <span>İlerleme</span>
                                <span>{Math.round((cat.totalProduced / Math.max(1, cat.totalQuantity)) * 100)}%</span>
                              </div>
                              <div className="h-1.5 bg-slate-100 rounded mt-1 overflow-hidden">
                                <div className="h-full bg-emerald-500"
                                     style={{ width: `${Math.min(100, Math.round((cat.totalProduced / Math.max(1, cat.totalQuantity)) * 100))}%` }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 🛒 Pazar Yerleri (hiyerarşik) */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <ShoppingCart className="w-6 h-6 text-slate-700" />
          <h2 className="text-xl font-semibold text-slate-900">Pazar Yerleri</h2>
          <span className="text-xs text-slate-500">Bölge → Destinasyon → Pazar yeri</span>
        </div>

        <div className="space-y-6">
          {REGIONS.map(region => {
            const regionDests = DESTINATIONS_BY_REGION[region];
            const hasAnyData = regionDests.some(destCode => {
              const detailCodes = DETAIL_CHANNELS_BY_DESTINATION[destCode] ?? [];
              const mps = [destCode, ...detailCodes];
              return mps.some(code => {
                const mp = allMarketplaces.find(m => m.code === code);
                return mp && (getMpSummary(mp.id)?.requestCount ?? 0) > 0;
              });
            });
            return (
              <div key={region} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-slate-800">{REGION_LABELS[region]}</h3>
                  <button
                    onClick={() => setNewRequestRegion(region)}
                    className="text-xs px-2 py-1 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Talep
                  </button>
                </div>
                {!hasAnyData && (
                  <p className="text-xs text-slate-400 italic mb-2">Bu bölgede {monthLabel} için talep yok</p>
                )}
                <div className="space-y-4">
                  {regionDests.map(destCode => {
                    const destMp = allMarketplaces.find(m => m.code === destCode);
                    if (!destMp) return null;
                    const detailCodes = DETAIL_CHANNELS_BY_DESTINATION[destCode] ?? [];
                    const detailMps = detailCodes.map(c => allMarketplaces.find(m => m.code === c)).filter(Boolean) as MarketplaceMeta[];
                    const allChildren = [destMp, ...detailMps];
                    const childCount = allChildren.reduce((s, mp) => s + (getMpSummary(mp.id)?.requestCount ?? 0), 0);
                    if (childCount === 0 && allChildren.length <= 1) return null;
                    return (
                      <div key={destCode} className="border-l-2 border-slate-200 pl-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-sm font-semibold text-slate-700">🚚 {destMp.name}</div>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">{destCode}</span>
                          <span className="text-[10px] text-slate-400">{childCount} talep</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                          {allChildren.map(mp => {
                            const sum = getMpSummary(mp.id);
                            const requestCount = sum?.requestCount ?? 0;
                            const qty = sum?.totalQuantity ?? 0;
                            const desi = sum?.totalDesi ?? 0;
                            const completedQty = sum?.completedQty ?? 0;
                            const completedDesi = sum?.completedDesi ?? 0;
                            const displayValue = viewMode === 'quantity' ? qty : Math.round(desi);
                            const completionPct = viewMode === 'quantity'
                              ? (qty > 0 ? Math.round((completedQty / qty) * 100) : 0)
                              : (desi > 0 ? Math.round((completedDesi / desi) * 100) : 0);
                            const isDest = mp.code === destCode;
                            return (
                              <div key={mp.id}
                                className={`p-3 rounded-lg border-2 ${isDest ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'} hover:shadow-sm transition-shadow`}>
                                <div className="flex items-center gap-2 mb-2">
                                  <ShoppingCart className="w-3.5 h-3.5 text-slate-500" />
                                  <p className="text-xs font-semibold text-slate-800">{mp.name}</p>
                                  {isDest && <span className="text-[9px] px-1 py-0.5 bg-slate-200 text-slate-700 rounded font-mono">DEST</span>}
                                </div>
                                <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
                                  <div><p className="text-slate-500">Talep</p><p className={`font-bold ${requestCount > 0 ? 'text-slate-900' : 'text-slate-400'}`}>{requestCount}</p></div>
                                  <div><p className="text-slate-500">{viewMode === 'quantity' ? 'Adet' : 'Desi'}</p><p className={`font-bold ${displayValue > 0 ? 'text-purple-600' : 'text-slate-400'}`}>{displayValue}</p></div>
                                  <div><p className="text-slate-500">Tamam</p><p className={`font-bold ${completionPct > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>%{completionPct}</p></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modals */}
      {acceptModal && (
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
          onSuccess={() => { setAcceptModal(null); loadAll(); }}
        />
      )}

      {newRequestRegion && (
        <NewRequestModal
          defaultRegion={newRequestRegion}
          marketplaces={allMarketplaces
            .filter(m => DESTINATIONS_BY_REGION[newRequestRegion].includes(m.code))
            .map(m => ({ id: m.id, code: m.code, name: m.name }))}
          onClose={() => setNewRequestRegion(null)}
          onSuccess={() => { setNewRequestRegion(null); loadAll(); }}
        />
      )}
    </div>
  );
}
