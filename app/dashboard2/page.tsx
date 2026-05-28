/**
 * Dashboard 2 — Merkezi Üretim Talebi (2026-05-28 revizyon)
 *
 * - StockPulse tavsiyeleri otomatik PR olarak yazılır (suggestion ara aşaması yok)
 * - Üst: ay seçim + Adet/Desi toggle + Toplam Talep/Miktar + üretici grup özetleri
 * - Orta: Kategoriye Göre Üretim (IWA Fabrika / CİTİ Mobilya / Hazır Alım)
 * - Alt: Pazar Yerleri — Bölge başlık + destinasyon kart flat + tıkla inline expand
 *   (Bölge başlık sembolik gruplama, kart hiyerarşisi 2 seviye)
 *
 * Mevcut /dashboard/month/[month] sayfası dokunulmadı (paralel kalır).
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Calendar, Package, ShoppingCart, Factory, Plus, ChevronDown,
  Hammer, Sofa, ShoppingBag, Lock, RefreshCw, Truck,
} from 'lucide-react';
import { notify } from '@/lib/ui/notify';
import { createLogger } from '@/lib/logger';
import { getActiveMonths, parseMonthValue, formatMonthDisplay } from '@/lib/monthUtils';
import { NewRequestModal } from '@/components/forms/NewRequestModal';
import {
  REGIONS, REGION_LABELS, DESTINATIONS_BY_REGION,
  DETAIL_CHANNELS_BY_DESTINATION,
  type Region,
} from '@/lib/marketplaceRegions';

const logger = createLogger('Dashboard2');

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

export default function Dashboard2Page() {
  const [month, setMonth] = useState<string>('2026-06');
  const [availableMonths, setAvailableMonths] = useState<Array<{ value: string; label: string; locked: boolean }>>([]);
  const [viewMode, setViewMode] = useState<'quantity' | 'desi'>('quantity');
  const [loading, setLoading] = useState(true);

  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [marketplaceSummary, setMarketplaceSummary] = useState<MarketplaceSummary[]>([]);
  const [allMarketplaces, setAllMarketplaces] = useState<MarketplaceMeta[]>([]);
  const [monthStats, setMonthStats] = useState({ totalRequests: 0, totalQuantity: 0, totalDesi: 0 });

  const [newRequestRegion, setNewRequestRegion] = useState<Region | null>(null);
  const [expandedDest, setExpandedDest] = useState<Set<string>>(new Set());

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
      const [mpRes, monthlyRes] = await Promise.all([
        fetch('/api/marketplaces?limit=200'),
        fetch(`/api/requests/monthly?month=${month}`),
      ]);
      const [mp, monthly] = await Promise.all([mpRes.json(), monthlyRes.json()]);

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
    } catch (err) {
      logger.error('Load error:', err);
      notify.error('Veriler yüklenemedi', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const getMpSummary = (mpId: string) => marketplaceSummary.find(s => s.marketplaceId === mpId);

  const groupTotals = useMemo(() => {
    return PRODUCTION_GROUPS.map(group => {
      const groupCats = categories.filter(c => getProductionGroup(c.productCategory) === group.key);
      const totalQty = groupCats.reduce((s, c) => s + c.totalQuantity, 0);
      const totalDesi = groupCats.reduce((s, c) => s + c.totalDesi, 0);
      return { ...group, cats: groupCats, totalQty, totalDesi };
    }).filter(g => g.totalQty > 0 || g.totalDesi > 0);
  }, [categories]);

  // Bölge başına toplam (destinasyon + detay kanal toplamları)
  const regionTotals = useMemo(() => {
    const result: Record<Region, { qty: number; desi: number; requests: number }> = {
      US: { qty: 0, desi: 0, requests: 0 },
      UK: { qty: 0, desi: 0, requests: 0 },
      EU: { qty: 0, desi: 0, requests: 0 },
      OTHER: { qty: 0, desi: 0, requests: 0 },
    };
    REGIONS.forEach(reg => {
      DESTINATIONS_BY_REGION[reg].forEach(destCode => {
        const detailCodes = DETAIL_CHANNELS_BY_DESTINATION[destCode] ?? [];
        [destCode, ...detailCodes].forEach(code => {
          const mp = allMarketplaces.find(m => m.code === code);
          if (!mp) return;
          const sum = getMpSummary(mp.id);
          if (!sum) return;
          result[reg].qty += sum.totalQuantity;
          result[reg].desi += sum.totalDesi;
          result[reg].requests += sum.requestCount;
        });
      });
    });
    return result;
  }, [allMarketplaces, marketplaceSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthLabel = useMemo(() => {
    try { return parseMonthValue(month).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }); }
    catch { return month; }
  }, [month]);

  const toggleExpand = (destCode: string) => {
    setExpandedDest(prev => {
      const next = new Set(prev);
      if (next.has(destCode)) next.delete(destCode);
      else next.add(destCode);
      return next;
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-b from-slate-50 to-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <Calendar className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{monthLabel}</h1>
              <p className="text-xs text-purple-600 font-medium">Dashboard 2 — Merkezi Üretim Talebi</p>
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
              onClick={() => notify.info('Ay Kilitle özelliği sonraki fazda aktif olacak')}
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

      {/* Kategoriye Göre Üretim */}
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

      {/* Pazar Yerleri — Bölge başlık + destinasyon flat + inline expand */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <ShoppingCart className="w-6 h-6 text-slate-700" />
          <h2 className="text-xl font-semibold text-slate-900">Pazar Yerleri</h2>
          <span className="text-xs text-slate-500">Bölge → Destinasyon → tıkla pazar yerleri</span>
        </div>

        <div className="space-y-6">
          {REGIONS.map(region => {
            const dests = DESTINATIONS_BY_REGION[region]
              .map(code => allMarketplaces.find(m => m.code === code))
              .filter(Boolean) as MarketplaceMeta[];
            const tot = regionTotals[region];
            const displayValue = viewMode === 'quantity' ? tot.qty : Math.round(tot.desi);
            return (
              <div key={region}>
                {/* Bölge başlığı */}
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-baseline gap-3">
                    <h3 className="text-base font-bold text-slate-800">{REGION_LABELS[region]}</h3>
                    <span className="text-xs text-slate-500">
                      {tot.requests} talep · {displayValue.toLocaleString('tr-TR')} {viewMode === 'quantity' ? 'adet' : 'desi'}
                    </span>
                  </div>
                  <button
                    onClick={() => setNewRequestRegion(region)}
                    className="text-xs px-2 py-1 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Talep
                  </button>
                </div>

                {/* Destinasyon kartları flat grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {dests.map(destMp => {
                    const detailCodes = DETAIL_CHANNELS_BY_DESTINATION[destMp.code] ?? [];
                    const detailMps = detailCodes
                      .map(c => allMarketplaces.find(m => m.code === c))
                      .filter(Boolean) as MarketplaceMeta[];

                    // Destinasyon kartı toplam = kendisi + detay kanallar toplamı
                    const allMps = [destMp, ...detailMps];
                    const totQty = allMps.reduce((s, mp) => s + (getMpSummary(mp.id)?.totalQuantity ?? 0), 0);
                    const totDesi = allMps.reduce((s, mp) => s + (getMpSummary(mp.id)?.totalDesi ?? 0), 0);
                    const totReq = allMps.reduce((s, mp) => s + (getMpSummary(mp.id)?.requestCount ?? 0), 0);
                    const completedQty = allMps.reduce((s, mp) => s + (getMpSummary(mp.id)?.completedQty ?? 0), 0);
                    const completedDesi = allMps.reduce((s, mp) => s + (getMpSummary(mp.id)?.completedDesi ?? 0), 0);
                    const completionPct = viewMode === 'quantity'
                      ? (totQty > 0 ? Math.round((completedQty / totQty) * 100) : 0)
                      : (totDesi > 0 ? Math.round((completedDesi / totDesi) * 100) : 0);
                    const cardDisplay = viewMode === 'quantity' ? totQty : Math.round(totDesi);
                    const isOpen = expandedDest.has(destMp.code);
                    const hasDetails = detailMps.length > 0;

                    return (
                      <div key={destMp.code}
                        className={`bg-white rounded-xl border-2 transition-all ${
                          isOpen ? 'border-purple-400 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
                        }`}>
                        <button
                          onClick={() => hasDetails && toggleExpand(destMp.code)}
                          className={`w-full p-4 text-left ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <div className="flex items-center gap-2">
                              <Truck className="w-4 h-4 text-purple-600" />
                              <p className="text-sm font-semibold text-slate-900">{destMp.name}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[9px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                                {destMp.code}
                              </span>
                              {hasDetails && (
                                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-center text-xs">
                            <div>
                              <p className="text-slate-500 text-[10px]">Talep</p>
                              <p className={`font-bold ${totReq > 0 ? 'text-slate-900' : 'text-slate-400'}`}>{totReq}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 text-[10px]">{viewMode === 'quantity' ? 'Adet' : 'Desi'}</p>
                              <p className={`font-bold ${cardDisplay > 0 ? 'text-purple-600' : 'text-slate-400'}`}>{cardDisplay.toLocaleString('tr-TR')}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 text-[10px]">Tamam</p>
                              <p className={`font-bold ${completionPct > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>%{completionPct}</p>
                            </div>
                          </div>
                          {hasDetails && (
                            <p className="text-[10px] text-slate-400 mt-2 text-right">
                              {detailMps.length} pazar yeri · {isOpen ? 'kapat' : 'göster'}
                            </p>
                          )}
                        </button>

                        {/* Inline expand: detay kanal pazar yerleri */}
                        {isOpen && hasDetails && (
                          <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                            <p className="text-[10px] font-semibold uppercase text-slate-500 mb-2">Pazar Yerleri</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {allMps.map(mp => {
                                const sum = getMpSummary(mp.id);
                                const requestCount = sum?.requestCount ?? 0;
                                const qty = sum?.totalQuantity ?? 0;
                                const desi = sum?.totalDesi ?? 0;
                                const v = viewMode === 'quantity' ? qty : Math.round(desi);
                                const isDest = mp.code === destMp.code;
                                return (
                                  <div key={mp.id}
                                    className={`p-2 rounded border ${isDest ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <p className="text-[11px] font-semibold text-slate-700 truncate">{mp.name}</p>
                                      {isDest && (
                                        <span className="text-[8px] px-1 bg-slate-200 text-slate-600 rounded font-mono">DEST</span>
                                      )}
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                                      <span>{requestCount} talep</span>
                                      <span className={`font-bold ${v > 0 ? 'text-purple-600' : 'text-slate-400'}`}>
                                        {v > 0 ? v.toLocaleString('tr-TR') : '-'}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
