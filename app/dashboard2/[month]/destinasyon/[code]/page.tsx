/**
 * Dashboard 2 — Destinasyon Detay
 *
 * Bir destinasyona (NJ Depo, AMZN_US, vb.) ait talepler tablo halinde.
 * Çoklu pazar yeri olabilir (NJ Depo altında Shopify/Walmart/CITI/Etsy gibi) —
 * "Pazar Yeri" kolonu hangi alt kanaldan geldiğini gösterir, filter yapılabilir.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Truck, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { notify } from '@/lib/ui/notify';
import { createLogger } from '@/lib/logger';
import { parseMonthValue } from '@/lib/monthUtils';
import { NewRequestModal } from '@/components/forms/NewRequestModal';
import {
  regionForMarketplace, REGION_LABELS, destinationLabel,
  SHIPMENT_DESTINATION_LABELS, SHIPMENT_DESTINATION_STYLES,
} from '@/lib/marketplaceRegions';

const logger = createLogger('Dashboard2Destinasyon');

interface MarketplaceMeta { id: string; code: string; name: string; region: string; }

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
  l30: number; l90: number; l180: number;
  formulaVersion: string | null;
  reasoning: string | null;
  createdAt: string;
  notes: string | null;
  recommendedDestination: string | null;
}

export default function DestinasyonDetailPage() {
  const params = useParams<{ month: string; code: string }>();
  const month = params?.month ?? '';
  const destCode = params?.code ?? '';

  const [allMarketplaces, setAllMarketplaces] = useState<MarketplaceMeta[]>([]);
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  // V1 tarzı chip durum filter: '' (Tümü) | 'REQUESTED' | 'PARTIALLY_PRODUCED' | 'COMPLETED'
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [destFilter, setDestFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [q, setQ] = useState('');
  const [newReqOpen, setNewReqOpen] = useState(false);

  const destMp = useMemo(() => allMarketplaces.find(m => m.code === destCode), [allMarketplaces, destCode]);
  // Artık sayfa SADECE bu pazar yerinin PR'larını gösterir (alt-detay kanal yok).
  const channelMps = useMemo(() => destMp ? [destMp] : [], [destMp]);
  const region = useMemo(() => regionForMarketplace(destCode), [destCode]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const mpRes = await fetch('/api/marketplaces?limit=200');
      const mpData = await mpRes.json();
      if (mpData.success) setAllMarketplaces(mpData.data);

      // production-pipeline region bazlı tüm PR'ları döner; client tarafında
      // sadece bu pazar yerine ait olanları filtrele.
      const reg = regionForMarketplace(destCode);
      if (reg) {
        const res = await fetch(`/api/production-pipeline?region=${reg}&productionMonth=${month}`);
        const data = await res.json();
        if (data.success) {
          const filtered = (data.data.items as PipelineItem[]).filter(it => it.marketplaceCode === destCode);
          setItems(filtered);
        }
      }
    } catch (err) {
      logger.error('Load error:', err);
      notify.error('Veriler yüklenemedi', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [month, destCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unique destinasyon ve kategori listeleri (dropdown'lar için)
  const availableDestinations = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.recommendedDestination) set.add(it.recommendedDestination);
    return [...set].sort();
  }, [items]);
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.productCategory) set.add(it.productCategory);
    return [...set].sort();
  }, [items]);

  // Filter (marketplace zaten tek — sayfa marketplaceCode'a göre).
  // statusFilter='REQUESTED' chipi REQUESTED + IN_PRODUCTION birleşik (operatör için "Talep" tek grup).
  const matchesStatus = (status: string, filter: string) => {
    if (!filter) return true;
    if (filter === 'REQUESTED') return status === 'REQUESTED' || status === 'IN_PRODUCTION';
    return status === filter;
  };
  const filtered = useMemo(() => {
    return items.filter(it => {
      if (!matchesStatus(it.status, statusFilter)) return false;
      if (destFilter && it.recommendedDestination !== destFilter) return false;
      if (categoryFilter && it.productCategory !== categoryFilter) return false;
      if (q) {
        const ql = q.toLowerCase();
        if (!it.iwasku.toLowerCase().includes(ql) && !it.productName.toLowerCase().includes(ql)) return false;
      }
      return true;
    });
  }, [items, statusFilter, destFilter, categoryFilter, q]);

  // Durum chip sayıları (filter dışı kalanlar dahil sayım — operatör hızlı görsün)
  const statusCounts = useMemo(() => {
    const base = items.filter(it => {
      if (destFilter && it.recommendedDestination !== destFilter) return false;
      if (categoryFilter && it.productCategory !== categoryFilter) return false;
      if (q) {
        const ql = q.toLowerCase();
        if (!it.iwasku.toLowerCase().includes(ql) && !it.productName.toLowerCase().includes(ql)) return false;
      }
      return true;
    });
    return {
      all: base.length,
      REQUESTED: base.filter(it => it.status === 'REQUESTED' || it.status === 'IN_PRODUCTION').length,
      PARTIALLY_PRODUCED: base.filter(it => it.status === 'PARTIALLY_PRODUCED').length,
      COMPLETED: base.filter(it => it.status === 'COMPLETED').length,
    };
  }, [items, destFilter, categoryFilter, q]);

  const monthLabel = useMemo(() => {
    try { return parseMonthValue(month).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }); }
    catch { return month; }
  }, [month]);

  const totals = useMemo(() => ({
    count: filtered.length,
    qty: filtered.reduce((s, it) => s + it.quantity, 0),
    desi: filtered.reduce((s, it) => s + (it.productSize ?? 0) * it.quantity, 0),
  }), [filtered]);

  const cancelRequest = async (id: string) => {
    if (!confirm('Bu talep iptal edilsin mi?')) return;
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? data.error ?? 'Hata');
      notify.success('İptal edildi');
      loadAll();
    } catch (err) { notify.error('İptal edilemedi', err); }
  };

  // Bulk delete: bu marketplace + bu üretim ayı için tüm STOCKPULSE talepleri sil.
  // Manuel/Excel + COMPLETED/CANCELLED dokunulmaz. Süper-admin only (backend gate).
  const bulkDeleteStockpulse = async () => {
    if (!destMp) return;
    // Hedef: STOCKPULSE entryType + status NOT IN (COMPLETED, CANCELLED)
    const targets = items.filter(it =>
      (it.source === 'AUTO' || it.source === 'AUTO_ACCEPTED') &&
      it.status !== 'COMPLETED' && it.status !== 'CANCELLED',
    );
    if (targets.length === 0) {
      notify.error('Silinecek STOCKPULSE talebi yok');
      return;
    }
    const confirmed = confirm(
      `${destMp.code} (${monthLabel}) için ${targets.length} STOCKPULSE talebi SİLİNECEK.\n` +
      `Manuel girilen veya tamamlanmış kayıtlar korunur. Devam edilsin mi?`,
    );
    if (!confirmed) return;
    try {
      const res = await fetch('/api/requests/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketplaceId: destMp.id, productionMonth: month }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? data.error ?? 'Hata');
      notify.success(`${data.deleted} talep silindi`);
      loadAll();
    } catch (err) { notify.error('Toplu silme başarısız', err); }
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

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      REQUESTED:          { bg: 'bg-sky-100',   text: 'text-sky-800',   label: 'Talep' },
      IN_PRODUCTION:      { bg: 'bg-indigo-100',text: 'text-indigo-800',label: 'Üretimde' },
      PARTIALLY_PRODUCED: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Kısmi' },
      COMPLETED:          { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Tamam' },
      CANCELLED:          { bg: 'bg-slate-200', text: 'text-slate-600', label: 'İptal' },
    };
    const cfg = map[status] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: status };
    return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>;
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      {/* Breadcrumb + Header */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/dashboard2" className="hover:text-purple-600">Dashboard 2</Link>
        <span>›</span>
        <Link href={`/dashboard2/${month}`} className="hover:text-purple-600">{monthLabel}</Link>
        <span>›</span>
        <span className="text-slate-700 font-medium">{destinationLabel(destCode, destMp?.name)}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/dashboard2/${month}`} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="p-2 bg-purple-100 rounded-lg">
            <Truck className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{destinationLabel(destCode, destMp?.name)}</h1>
            <p className="text-xs text-slate-500">
              {region ? REGION_LABELS[region] : ''} · {channelMps.length} pazar yeri · {monthLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadAll} disabled={loading}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 flex items-center gap-1">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
          <button
            onClick={bulkDeleteStockpulse}
            disabled={loading}
            title="Bu marketplace + ay için tüm STOCKPULSE (AUTO) taleplerini sil. Manuel/Excel + tamamlanmış kayıtlar korunur."
            className="px-3 py-2 border border-rose-300 text-rose-700 rounded-lg text-sm hover:bg-rose-50 flex items-center gap-1 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Toplu Sil (AUTO)
          </button>
          <button onClick={() => setNewReqOpen(true)}
            className="px-3 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 flex items-center gap-1">
            <Plus className="w-4 h-4" /> Yeni Talep
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded p-3">
          <p className="text-[10px] text-slate-500 uppercase">Toplam Talep</p>
          <p className="text-2xl font-bold text-slate-900">{totals.count}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3">
          <p className="text-[10px] text-slate-500 uppercase">Toplam Adet</p>
          <p className="text-2xl font-bold text-purple-700">{totals.qty.toLocaleString('tr-TR')}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3">
          <p className="text-[10px] text-slate-500 uppercase">Toplam Desi</p>
          <p className="text-2xl font-bold text-emerald-700">{Math.round(totals.desi).toLocaleString('tr-TR')}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap gap-3 items-end">
        {/* Durum chip butonlar (V1 tarzı) */}
        <div className="flex-1 min-w-[280px]">
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Durum</label>
          <div className="flex gap-1 flex-wrap">
            {[
              { key: '', label: 'Tümü', count: statusCounts.all, bg: 'bg-slate-100', text: 'text-slate-700', active: 'bg-slate-700 text-white' },
              { key: 'REQUESTED', label: 'Talep Edildi', count: statusCounts.REQUESTED, bg: 'bg-sky-50', text: 'text-sky-700', active: 'bg-sky-600 text-white' },
              { key: 'PARTIALLY_PRODUCED', label: 'Kısmen', count: statusCounts.PARTIALLY_PRODUCED, bg: 'bg-amber-50', text: 'text-amber-700', active: 'bg-amber-600 text-white' },
              { key: 'COMPLETED', label: 'Tamamlandı', count: statusCounts.COMPLETED, bg: 'bg-emerald-50', text: 'text-emerald-700', active: 'bg-emerald-600 text-white' },
            ].map(chip => {
              const isActive = statusFilter === chip.key;
              return (
                <button key={chip.key} onClick={() => setStatusFilter(chip.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    isActive ? chip.active : `${chip.bg} ${chip.text} hover:opacity-80`
                  }`}>
                  {chip.label} <span className="opacity-70">({chip.count})</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Destinasyon</label>
          <select value={destFilter} onChange={e => setDestFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-36">
            <option value="">Tümü</option>
            {availableDestinations.map(d => (
              <option key={d} value={d}>{SHIPMENT_DESTINATION_LABELS[d] ?? d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Kategori</label>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-40">
            <option value="">Tümü</option>
            {availableCategories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[10px] uppercase text-slate-500 mb-1">Ara</label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="iwasku veya ürün adı..."
              className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>
      </div>

      {/* PR tablosu */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap">IWASKU</th>
                <th className="px-3 py-2 text-left text-xs font-medium">Ürün</th>
                <th className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap">Destinasyon</th>
                <th className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap">Kategori</th>
                <th className="px-3 py-2 text-right text-xs font-medium whitespace-nowrap">Adet</th>
                <th className="px-3 py-2 text-right text-xs font-medium whitespace-nowrap">L30</th>
                <th className="px-3 py-2 text-right text-xs font-medium whitespace-nowrap">L90</th>
                <th className="px-3 py-2 text-center text-xs font-medium whitespace-nowrap">Source</th>
                <th className="px-3 py-2 text-center text-xs font-medium whitespace-nowrap">Durum</th>
                <th className="px-3 py-2 text-center text-xs font-medium whitespace-nowrap">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                  {monthLabel} için bu destinasyonda talep yok
                </td></tr>
              )}
              {filtered.map(it => (
                <tr key={`${it.type}-${it.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5 font-mono text-xs text-cyan-700 whitespace-nowrap">{it.iwasku}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-900 break-words" title={it.productName}>{it.productName}</td>
                  <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                    {it.recommendedDestination ? (() => {
                      const style = SHIPMENT_DESTINATION_STYLES[it.recommendedDestination]
                        ?? { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };
                      return (
                        <span className={`px-1.5 py-0.5 rounded border text-[11px] font-medium ${style.bg} ${style.text} ${style.border}`}>
                          {SHIPMENT_DESTINATION_LABELS[it.recommendedDestination] ?? it.recommendedDestination}
                        </span>
                      );
                    })() : (
                      <span className="text-slate-400 text-[11px]">-</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-slate-600 whitespace-nowrap">{it.productCategory}</td>
                  <td className="px-3 py-1.5 text-right text-sm font-bold text-purple-700 tabular-nums whitespace-nowrap">{it.quantity.toLocaleString('tr-TR')}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-600 whitespace-nowrap">{it.l30 || '-'}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-600 whitespace-nowrap">{it.l90 || '-'}</td>
                  <td className="px-3 py-1.5 text-center whitespace-nowrap">{sourceBadge(it.source)}</td>
                  <td className="px-3 py-1.5 text-center whitespace-nowrap">{statusBadge(it.status)}</td>
                  <td className="px-3 py-1.5 text-center whitespace-nowrap">
                    {it.type === 'request' && it.status !== 'COMPLETED' && it.status !== 'CANCELLED' && (
                      <button onClick={() => cancelRequest(it.id)}
                        className="px-2 py-0.5 text-rose-600 hover:bg-rose-50 rounded text-xs flex items-center gap-1 mx-auto"
                        title="İptal Et">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {newReqOpen && region && (
        <NewRequestModal
          defaultRegion={region}
          marketplaces={channelMps.map(m => ({ id: m.id, code: m.code, name: m.name }))}
          onClose={() => setNewReqOpen(false)}
          onSuccess={() => { setNewReqOpen(false); loadAll(); }}
        />
      )}
    </div>
  );
}
