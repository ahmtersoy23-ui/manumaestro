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
import { useParams, useRouter } from 'next/navigation';
import {
  Calendar, Package, ShoppingCart, Factory, Plus,
  Hammer, Sofa, ShoppingBag, Lock, RefreshCw, Truck, Camera, ArrowLeft, ChevronDown,
} from 'lucide-react';
import { notify } from '@/lib/ui/notify';
import { createLogger } from '@/lib/logger';
import { parseMonthValue, isLegacyMonth } from '@/lib/monthUtils';
import { NewRequestModal } from '@/components/forms/NewRequestModal';
import { MarketplacePriority as MarketplacePriorityComponent } from '@/components/seasonal/MarketplacePriority';
import { useAuth } from '@/contexts/AuthContext';
import {
  REGIONS, REGION_LABELS, DESTINATIONS_BY_REGION,
  DETAIL_CHANNELS_BY_DESTINATION, destinationLabel,
  SHIPMENT_DESTINATIONS_BY_COUNTRY, SHIPMENT_DESTINATION_LABELS, SHIPMENT_DESTINATION_STYLES,
  type Region, type ShipmentCountry,
} from '@/lib/marketplaceRegions';

// Region (US/UK/EU/OTHER) → ShipmentCountry listesi (havuz destinasyonları için).
// OTHER bölgesi CA/AU/ZA içerir (her biri tek FBA destinasyon).
const REGION_TO_COUNTRIES: Record<Region, ShipmentCountry[]> = {
  US: ['US'], UK: ['UK'], EU: ['EU'], OTHER: ['CA', 'AU', 'ZA'],
};

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

interface DestinationSummary {
  destination: string;
  totalQuantity: number;
  totalDesi: number;
  requestCount: number;
  completedQty: number;
  completedDesi: number;
}

interface MarketplaceMeta {
  id: string;
  code: string;
  name: string;
  region: string;
}

export default function Dashboard2MonthPage() {
  const params = useParams<{ month: string }>();
  const month = params?.month ?? '';
  const router = useRouter();
  const [viewMode, setViewMode] = useState<'quantity' | 'desi'>('desi');
  const { role } = useAuth();
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [marketplaceSummary, setMarketplaceSummary] = useState<MarketplaceSummary[]>([]);
  const [destinationSummary, setDestinationSummary] = useState<DestinationSummary[]>([]);
  const [allMarketplaces, setAllMarketplaces] = useState<MarketplaceMeta[]>([]);
  const [monthStats, setMonthStats] = useState({ totalRequests: 0, totalQuantity: 0, totalDesi: 0 });
  const [iwaskuSummary, setIwaskuSummary] = useState<{iwasku: string; category: string; totalQty: number; desi: number}[]>([]);

  // Snapshot: depo stoğu sabitlenmiş (ay sonu) veya canlı (admin tetikli)
  interface SnapshotItem {
    iwasku: string;
    productName: string;
    productCategory: string;
    totalRequested: number;
    warehouseStock: number;
    netProduction: number;
    produced: number;
    desi: number | null;
  }
  const [snapshotData, setSnapshotData] = useState<{
    summary: { totalRequested: number; totalStock: number; totalNet: number };
    snapshots: SnapshotItem[];
  } | null>(null);

  const [newRequestRegion, setNewRequestRegion] = useState<Region | null>(null);
  const [snapshotGenerating, setSnapshotGenerating] = useState(false);

  const handleGenerateSnapshot = async () => {
    if (!confirm(`${month} ayı için depo snapshot alınsın mı?`)) return;
    setSnapshotGenerating(true);
    try {
      const res = await fetch('/api/month-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? data.error ?? 'Snapshot alınamadı');
      notify.success('Depo snapshot alındı');
      await loadAll();
    } catch (err) {
      notify.error('Snapshot alınamadı', err);
    } finally {
      setSnapshotGenerating(false);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [mpRes, monthlyRes, snapRes] = await Promise.all([
        fetch('/api/marketplaces?limit=200'),
        fetch(`/api/requests/monthly?month=${month}`),
        fetch(`/api/month-snapshot?month=${month}`),
      ]);
      const [mp, monthly, snap] = await Promise.all([mpRes.json(), monthlyRes.json(), snapRes.json()]);

      if (mp.success) setAllMarketplaces(mp.data);
      if (monthly.success) {
        setCategories((monthly.data.summary || []).sort((a: CategorySummary, b: CategorySummary) => b.totalQuantity - a.totalQuantity));
        setMarketplaceSummary(monthly.data.marketplaceSummary || []);
        setDestinationSummary(monthly.data.destinationSummary || []);
        setIwaskuSummary(monthly.data.iwaskuSummary || []);
        setMonthStats({
          totalRequests: monthly.data.totalRequests || 0,
          totalQuantity: monthly.data.totalQuantity || 0,
          totalDesi: monthly.data.totalDesi || 0,
        });
      }
      if (snap.success && snap.data.snapshots?.length > 0) {
        setSnapshotData({ summary: snap.data.summary, snapshots: snap.data.snapshots });
      } else {
        setSnapshotData(null);
      }
    } catch (err) {
      logger.error('Load error:', err);
      notify.error('Veriler yüklenemedi', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Eski aylar (Haziran 2026 öncesi) Dashboard 1 gösterimine yönlenir — yeni
    // gösterim recommendedDestination'a dayanıyor, eski veride o yok.
    if (isLegacyMonth(month)) { router.replace(`/dashboard/month/${month}`); return; }
    loadAll();
  }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const getMpSummary = (mpId: string) => marketplaceSummary.find(s => s.marketplaceId === mpId);

  // Kategori bazlı stok hesabı: snapshot stoku + iwaskuSummary canlı talep + produced
  interface CategoryStock {
    coveredQty: number; coveredDesi: number;
    netQty: number; netDesi: number;
    producedQty: number; producedDesi: number;
    kalanQty: number; kalanDesi: number;
  }
  const categoryStockMap = useMemo(() => {
    const map = new Map<string, CategoryStock>();
    if (!snapshotData || iwaskuSummary.length === 0) return map;
    const stockMap = new Map<string, number>();
    const producedMap = new Map<string, number>();
    const desiMap = new Map<string, number>();
    for (const s of snapshotData.snapshots) {
      stockMap.set(s.iwasku, s.warehouseStock);
      if (s.produced != null) producedMap.set(s.iwasku, s.produced);
      if (s.desi) desiMap.set(s.iwasku, s.desi);
    }
    for (const item of iwaskuSummary) {
      const cur = map.get(item.category) ?? { coveredQty: 0, coveredDesi: 0, netQty: 0, netDesi: 0, producedQty: 0, producedDesi: 0, kalanQty: 0, kalanDesi: 0 };
      const stock = stockMap.get(item.iwasku) ?? 0;
      const produced = producedMap.get(item.iwasku) ?? 0;
      const demand = item.totalQty;
      const covered = Math.min(stock, demand);
      const net = Math.max(0, demand - stock);
      const fulfilled = Math.min(produced, net);
      const rem = Math.max(0, net - produced);
      const desiPerUnit = desiMap.get(item.iwasku) ?? item.desi ?? 0;
      cur.coveredQty += covered;     cur.coveredDesi += covered * desiPerUnit;
      cur.netQty += net;             cur.netDesi += net * desiPerUnit;
      cur.producedQty += fulfilled;  cur.producedDesi += fulfilled * desiPerUnit;
      cur.kalanQty += rem;           cur.kalanDesi += rem * desiPerUnit;
      map.set(item.category, cur);
    }
    return map;
  }, [snapshotData, iwaskuSummary]);
  const hasStock = categoryStockMap.size > 0;

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

  if (isLegacyMonth(month)) {
    return <div className="p-6 text-center text-slate-500">Eski ay — Dashboard 1 görünümüne yönlendiriliyor…</div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-b from-slate-50 to-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <Link href="/dashboard2" className="p-2 hover:bg-slate-100 rounded-lg text-slate-600" title="Aylara geri dön">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <Calendar className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{monthLabel}</h1>
              <p className="text-xs text-purple-600 font-medium">Dashboard 2 — Merkezi Üretim Talebi</p>
            </div>
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
            <button onClick={handleGenerateSnapshot} disabled={snapshotGenerating || loading}
              className="px-3 py-2 border border-emerald-300 bg-emerald-50 rounded-lg text-sm hover:bg-emerald-100 text-emerald-700 flex items-center gap-1 disabled:opacity-50"
              title={snapshotData ? 'Snapshot mevcut · güncellemek için tıkla' : 'Depo stoğunu sabitle'}>
              <Camera className={`w-3.5 h-3.5 ${snapshotGenerating ? 'animate-pulse' : ''}`} />
              {snapshotData ? 'Snapshot Güncelle' : 'Depo Snapshot Al'}
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
            {hasStock ? (() => {
              const totals = Array.from(categoryStockMap.values()).reduce((s, c) => ({
                coveredQty: s.coveredQty + c.coveredQty,
                coveredDesi: s.coveredDesi + c.coveredDesi,
                netQty: s.netQty + c.netQty,
                netDesi: s.netDesi + c.netDesi,
              }), { coveredQty: 0, coveredDesi: 0, netQty: 0, netDesi: 0 });
              return (
                <>
                  <p className="text-slate-900 text-xs font-bold uppercase tracking-wider mb-2">Net İhtiyaç</p>
                  <p className="text-4xl font-black text-slate-900 tabular-nums">
                    {viewMode === 'quantity' ? totals.netQty.toLocaleString('tr-TR') : Math.round(totals.netDesi).toLocaleString('tr-TR')}
                    <span className="text-lg font-normal text-slate-400 ml-1.5">{viewMode === 'quantity' ? 'adet' : 'desi'}</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-2">
                    Talep {viewMode === 'quantity' ? monthStats.totalQuantity.toLocaleString('tr-TR') : Math.round(monthStats.totalDesi).toLocaleString('tr-TR')} · Depo {viewMode === 'quantity' ? totals.coveredQty.toLocaleString('tr-TR') : Math.round(totals.coveredDesi).toLocaleString('tr-TR')}
                  </p>
                </>
              );
            })() : (
              <>
                <p className="text-slate-900 text-xs font-bold uppercase tracking-wider mb-2">Toplam {viewMode === 'quantity' ? 'Miktar' : 'Desi'}</p>
                <p className="text-4xl font-black text-slate-900 tabular-nums">
                  {viewMode === 'quantity'
                    ? monthStats.totalQuantity.toLocaleString('tr-TR')
                    : Math.round(monthStats.totalDesi).toLocaleString('tr-TR')}
                </p>
                <p className="text-[10px] text-slate-400 mt-2">Depo stoğu için &quot;Depo Snapshot Al&quot;</p>
              </>
            )}
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
              // Grup stok hesabı
              const groupStock = g.cats.reduce((acc, cat) => {
                const cs = categoryStockMap.get(cat.productCategory);
                if (cs) {
                  acc.coveredQty += cs.coveredQty; acc.coveredDesi += cs.coveredDesi;
                  acc.netQty += cs.netQty; acc.netDesi += cs.netDesi;
                }
                return acc;
              }, { coveredQty: 0, coveredDesi: 0, netQty: 0, netDesi: 0 });
              const displayQty = hasStock ? groupStock.netQty : g.totalQty;
              const displayDesi = hasStock ? Math.round(groupStock.netDesi) : Math.round(g.totalDesi);
              const displayValue = viewMode === 'quantity' ? displayQty : displayDesi;
              return (
                <div key={g.key} className={`${c.bg} ${c.border} border rounded-xl p-4 text-center`}>
                  <p className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 ${c.text}`}>{g.label}</p>
                  <p className={`text-2xl font-black tabular-nums ${c.text}`}>{displayValue.toLocaleString('tr-TR')}</p>
                  <p className={`text-[11px] ${c.sub} mt-0.5`}>{hasStock ? 'net ihtiyaç' : (viewMode === 'quantity' ? 'adet' : 'desi')}</p>
                  {hasStock && (
                    <p className={`text-[10px] ${c.sub} mt-2 pt-2 border-t ${c.border}`}>
                      Talep {viewMode === 'quantity' ? g.totalQty.toLocaleString('tr-TR') : Math.round(g.totalDesi).toLocaleString('tr-TR')} · Depo {viewMode === 'quantity' ? groupStock.coveredQty.toLocaleString('tr-TR') : Math.round(groupStock.coveredDesi).toLocaleString('tr-TR')}
                    </p>
                  )}
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
                    {group.cats.map(cat => {
                      const cs = categoryStockMap.get(cat.productCategory);
                      const showStock = !!cs;
                      const talepVal = viewMode === 'quantity' ? cat.totalQuantity : Math.round(cat.totalDesi);
                      const stokVal = cs ? (viewMode === 'quantity' ? cs.coveredQty : Math.round(cs.coveredDesi)) : 0;
                      const netVal = cs ? (viewMode === 'quantity' ? cs.netQty : Math.round(cs.netDesi)) : talepVal;
                      const uretilenVal = cs ? (viewMode === 'quantity' ? cs.producedQty : Math.round(cs.producedDesi)) : (viewMode === 'quantity' ? cat.totalProduced : Math.round(cat.producedDesi));
                      const kalanVal = cs ? (viewMode === 'quantity' ? cs.kalanQty : Math.round(cs.kalanDesi)) : 0;
                      const progressBase = showStock ? netVal : cat.totalQuantity;
                      const progressPct = progressBase > 0 ? Math.round((uretilenVal / Math.max(1, progressBase)) * 100) : 0;
                      return (
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
                              <span className="text-slate-500">Talep</span>
                              <span className="font-bold text-slate-700">{talepVal.toLocaleString('tr-TR')}</span>
                            </div>
                            {showStock && (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Depo</span>
                                  <span className="font-bold text-emerald-600">{stokVal.toLocaleString('tr-TR')}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Net İhtiyaç</span>
                                  <span className={`font-bold ${c.value}`}>{netVal.toLocaleString('tr-TR')}</span>
                                </div>
                              </>
                            )}
                            {!showStock && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Talep Edilen</span>
                                <span className={`font-bold ${c.value}`}>{talepVal.toLocaleString('tr-TR')}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-slate-500">Üretilen</span>
                              <span className="font-bold text-slate-900">{uretilenVal.toLocaleString('tr-TR')}</span>
                            </div>
                            {showStock && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Kalan</span>
                                <span className={`font-bold ${kalanVal === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  {kalanVal === 0 ? '✓' : kalanVal.toLocaleString('tr-TR')}
                                </span>
                              </div>
                            )}
                            {progressBase > 0 && (
                              <div className="mt-2 pt-2 border-t border-slate-100">
                                <div className="flex justify-between text-[10px] text-slate-500">
                                  <span>İlerleme</span>
                                  <span>{progressPct}%</span>
                                </div>
                                <div className="h-1.5 bg-slate-100 rounded mt-1 overflow-hidden">
                                  <div className="h-full bg-emerald-500"
                                       style={{ width: `${Math.min(100, progressPct)}%` }} />
                                </div>
                              </div>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pazar Yerleri — Bölge başlık + destinasyon + altında pazar yerleri (her zaman açık) */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <ShoppingCart className="w-6 h-6 text-slate-700" />
          <h2 className="text-xl font-semibold text-slate-900">Pazar Yerleri</h2>
          <span className="text-xs text-slate-500">Bölge → Destinasyon → Pazar yerleri</span>
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

                {/* Destinasyon stats bandı — bölgenin sevkiyat hedefi başına özet */}
                {(() => {
                  const countries = REGION_TO_COUNTRIES[region];
                  const destCodes = countries.flatMap(c => SHIPMENT_DESTINATIONS_BY_COUNTRY[c]);
                  const destStats = destCodes.map(d => destinationSummary.find(s => s.destination === d))
                    .filter((s): s is DestinationSummary => !!s && s.requestCount > 0);
                  if (destStats.length === 0) return null;
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 mb-3 px-1">
                      {destStats.map(s => {
                        const style = SHIPMENT_DESTINATION_STYLES[s.destination]
                          ?? { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' };
                        const label = SHIPMENT_DESTINATION_LABELS[s.destination] ?? s.destination;
                        const display = viewMode === 'quantity' ? s.totalQuantity : Math.round(s.totalDesi);
                        const completedDisplay = viewMode === 'quantity' ? s.completedQty : Math.round(s.completedDesi);
                        const pct = display > 0 ? Math.round((completedDisplay / display) * 100) : 0;
                        return (
                          <div key={s.destination}
                            className={`rounded-lg border px-3 py-2 ${style.bg} ${style.border}`}>
                            <div className={`text-[10px] font-semibold uppercase ${style.text}`}>{label}</div>
                            <div className="mt-1 flex items-baseline gap-1.5">
                              <span className={`text-lg font-bold ${style.text}`}>{display.toLocaleString('tr-TR')}</span>
                              <span className="text-[9px] text-slate-500">
                                {viewMode === 'quantity' ? 'adet' : 'desi'} · {s.requestCount} talep
                              </span>
                            </div>
                            <div className="text-[9px] text-slate-500 mt-0.5">
                              Tamamlanan: %{pct}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Destinasyon kartları — büyük kart, tıkla detay sayfasına git */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {dests.map(destMp => {
                    const detailCodes = DETAIL_CHANNELS_BY_DESTINATION[destMp.code] ?? [];
                    const detailMps = detailCodes
                      .map(c => allMarketplaces.find(m => m.code === c))
                      .filter(Boolean) as MarketplaceMeta[];
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
                    const channelCount = detailMps.length + 1; // dest + detay

                    return (
                      <Link key={destMp.code}
                        href={`/dashboard2/${month}/destinasyon/${destMp.code}`}
                        className="block p-5 bg-white rounded-xl border-2 border-slate-200 hover:border-purple-500 hover:shadow-md transition-all group">
                        <div className="flex items-center justify-between gap-2 mb-4">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
                              <Truck className="w-5 h-5 text-purple-600" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{destinationLabel(destMp.code, destMp.name)}</p>
                              <p className="text-[10px] text-slate-500">
                                {channelCount > 1 ? `${channelCount} pazar yeri` : '1 pazar yeri'}
                              </p>
                            </div>
                          </div>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                            {destMp.code}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center pt-3 border-t border-slate-100">
                          <div>
                            <p className="text-slate-500 text-[10px] mb-0.5">Talep</p>
                            <p className={`text-lg font-bold ${totReq > 0 ? 'text-slate-900' : 'text-slate-400'}`}>{totReq}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-[10px] mb-0.5">{viewMode === 'quantity' ? 'Adet' : 'Desi'}</p>
                            <p className={`text-lg font-bold ${cardDisplay > 0 ? 'text-purple-600' : 'text-slate-400'}`}>{cardDisplay.toLocaleString('tr-TR')}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-[10px] mb-0.5">Tamamlandı</p>
                            <p className={`text-lg font-bold ${completionPct > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>%{completionPct}</p>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Öncelik Sıralaması — admin only (V1'den taşındı, 2026-05-30) */}
      {role === 'admin' && (
        <div className="px-6 pb-10">
          <button
            onClick={() => setPriorityOpen(o => !o)}
            className="flex items-center gap-3 mb-4 w-full text-left hover:opacity-80 transition-opacity"
          >
            <Factory className="w-6 h-6 text-purple-700" />
            <h2 className="text-2xl font-semibold text-gray-900">Öncelik Sıralaması</h2>
            <ChevronDown className={`w-5 h-5 text-gray-400 ml-auto transition-transform ${priorityOpen ? 'rotate-180' : ''}`} />
          </button>
          {priorityOpen && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <MarketplacePriorityComponent month={month} />
            </div>
          )}
        </div>
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
