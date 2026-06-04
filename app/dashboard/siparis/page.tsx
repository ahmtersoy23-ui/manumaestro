'use client';

/**
 * Birleşik Sipariş ekranı (top-level "Sipariş" ana tab) — Faz 1: SADECE süper-admin.
 * Wisersell → ManuMaestro otomasyonunun kontrol kulesi: Onay + Kapatma + izleme.
 * Per-warehouse /siparis akışına dokunmaz; operatör etiket/çıkışı orada yapar.
 * region: ülke-genişletilebilir (şimdi US).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Zap, CheckCircle2, PackageCheck, Truck, Send, Archive, AlertTriangle, MapPin, Printer, FileText, X, ChevronRight } from 'lucide-react';
import { LabelUploader } from '@/components/wms/LabelUploader';
import { ShipModal } from '@/components/wms/ShipModal';

type StatusKey = 'onayBekliyor' | 'etiketBekliyor' | 'cikisBekliyor' | 'kapatmaBekliyor' | 'kapandi';

const STATUS_META: Record<StatusKey, { label: string; desc: string; icon: typeof CheckCircle2; accent: string; ring: string; dot: string }> = {
  onayBekliyor:   { label: 'Onay Bekliyor',    desc: 'US stoğu teyitli, onay bekliyor', icon: CheckCircle2, accent: 'text-emerald-700', ring: 'ring-emerald-500 bg-emerald-50', dot: 'bg-emerald-500' },
  etiketBekliyor: { label: 'Etiket Bekliyor',  desc: 'Onaylandı, kargo etiketi bekliyor', icon: PackageCheck, accent: 'text-amber-700',  ring: 'ring-amber-500 bg-amber-50',   dot: 'bg-amber-500' },
  cikisBekliyor:  { label: 'Çıkış Bekliyor',   desc: 'Etiketli, fiziksel çıkış bekliyor', icon: Truck,        accent: 'text-sky-700',    ring: 'ring-sky-500 bg-sky-50',       dot: 'bg-sky-500' },
  kapatmaBekliyor:{ label: 'Kapatma Bekliyor', desc: 'Kargolandı, Wisersell kapatma',   icon: Send,         accent: 'text-rose-700',   ring: 'ring-rose-500 bg-rose-50',     dot: 'bg-rose-500' },
  kapandi:        { label: 'Kapandı',          desc: 'Wisersell external-close yazıldı', icon: Archive,      accent: 'text-slate-600',  ring: 'ring-slate-400 bg-slate-50',   dot: 'bg-slate-400' },
};
const STATUS_ORDER: StatusKey[] = ['onayBekliyor', 'etiketBekliyor', 'cikisBekliyor', 'kapatmaBekliyor', 'kapandi'];

const WH = {
  SHOWROOM: { label: 'Fairfield', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NJ:       { label: 'Somerset',  badge: 'bg-sky-50 text-sky-700 border-sky-200' },
} as const;
function whLabel(w?: string) { return w && w in WH ? WH[w as keyof typeof WH].label : (w ?? '—'); }
function whBadge(w?: string) { return w && w in WH ? WH[w as keyof typeof WH].badge : 'bg-gray-50 text-gray-600 border-gray-200'; }

interface ItemLite { iwasku: string | null; qty?: number; quantity?: number; name?: string | null; product_name?: string | null; }
interface Row {
  id?: string;
  wisersellOrderId?: number;
  orderCode?: string;
  orderNumber?: string;
  recipientName?: string | null;
  shipAddress?: string | null;
  addressNote?: string | null;
  labelNo?: string | null;
  warehouse?: string;
  marketplaceCode?: string;
  trackingNumber?: string | null;
  labelId?: string | null;
  readyPending?: boolean;
  items?: ItemLite[];
}
interface BoardData {
  counts: Record<string, number>;
  data: Record<StatusKey, Row[]>;
}

export default function SiparisPage() {
  const [region] = useState('US');
  const [board, setBoard] = useState<BoardData | null>(null);
  const [tab, setTab] = useState<StatusKey>('onayBekliyor');
  const [whFilter, setWhFilter] = useState<'ALL' | 'SHOWROOM' | 'NJ'>('ALL');
  const [mpFilter, setMpFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  const [shipOrder, setShipOrder] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/siparis/board?region=${region}`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Yüklenemedi');
      setBoard(json);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hata');
    } finally {
      setLoading(false);
    }
  }, [region]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); setWhFilter('ALL'); setMpFilter('ALL'); }, [tab]);

  const counts = board?.counts ?? {};
  const tabRows = useMemo(() => board?.data[tab] ?? [], [board, tab]);

  // Warehouse sayıları (aktif tab) + marketplace seçenekleri — client-side
  const whCounts = useMemo(() => {
    const c = { ALL: tabRows.length, SHOWROOM: 0, NJ: 0 };
    for (const r of tabRows) { if (r.warehouse === 'SHOWROOM') c.SHOWROOM++; else if (r.warehouse === 'NJ') c.NJ++; }
    return c;
  }, [tabRows]);
  const mpOptions = useMemo(() => [...new Set(tabRows.map((r) => r.marketplaceCode).filter(Boolean) as string[])].sort(), [tabRows]);

  const rows = useMemo(() => tabRows.filter((r) =>
    (whFilter === 'ALL' || r.warehouse === whFilter) &&
    (mpFilter === 'ALL' || r.marketplaceCode === mpFilter)
  ), [tabRows, whFilter, mpFilter]);

  const selectable = tab === 'onayBekliyor' || tab === 'cikisBekliyor' || tab === 'kapatmaBekliyor';
  const rowKey = useCallback((r: Row) => (tab === 'onayBekliyor' ? String(r.wisersellOrderId) : String(r.id)), [tab]);

  const toggle = (k: string) => setSelected((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleAll = () => setSelected((p) => p.size === rows.length ? new Set() : new Set(rows.map(rowKey)));

  async function runAction(url: string, body: unknown, okMsg: (j: { [k: string]: unknown }) => string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Hata');
      setMsg(okMsg(json));
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Hata'); } finally { setBusy(false); }
  }
  const doApprove = () => runAction('/api/siparis/approve', { wisersellOrderIds: [...selected].map(Number).filter(Boolean) }, (j) => `${j.approved} sipariş onaylandı.`);
  const approveOne = async (id?: number) => { if (!id) return; await runAction('/api/siparis/approve', { wisersellOrderIds: [id] }, (j) => `${j.approved} onaylandı.`); setDetailRow(null); };
  const closeOne = async (id?: string) => { if (!id) return; await runAction('/api/siparis/close', { orderIds: [id] }, (j) => `${j.closed} kapatıldı.`); setDetailRow(null); };
  const doClose = () => runAction('/api/siparis/close', { orderIds: [...selected] }, (j) => {
    const failed = ((j.results as { ok: boolean; message?: string }[]) || []).filter((r) => !r.ok);
    return `${j.closed} kapatıldı.${failed.length ? ` ${failed.length} başarısız: ${failed.map((f) => f.message).join('; ')}` : ''}`;
  });
  const doAutoRun = () => runAction(`/api/siparis/auto-run?region=${region}`, {}, (j) => `Otomatik: ${j.approved} onaylandı.`);

  // Toplu "Hazır Etiketleri Yazdır" — depoya münhasır (fiziksel mekan ayrı), seçili siparişler.
  const printSelected = () => {
    const byWh = new Map<string, string[]>();
    for (const id of selected) {
      const row = rows.find((r) => String(r.id) === id);
      if (row?.warehouse && row.id) { const a = byWh.get(row.warehouse) ?? []; a.push(row.id); byWh.set(row.warehouse, a); }
    }
    if (byWh.size === 0) { setMsg('Önce sipariş seçin.'); return; }
    for (const [wh, ids] of byWh) window.open(`/api/depolar/${wh}/labels/merge?orderIds=${ids.join(',')}`, '_blank');
  };

  const itemsText = (items?: ItemLite[]) =>
    (items ?? []).map((i) => `${i.name ?? i.product_name ?? i.iwasku ?? '?'} ×${i.qty ?? i.quantity ?? 0}`).join(', ');

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto">
      {/* Başlık */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Sipariş</h1>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-900 text-white">{region}</span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Wisersell → US depo otomasyonu · süper-admin kontrol</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
          <button onClick={doAutoRun} disabled={busy} title="WISERSELL_AUTO_APPROVE açıksa tüm uygun adayları onaylar" className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            <Zap className="w-4 h-4" /> Tümünü Onayla
          </button>
        </div>
      </div>

      {/* Durum kartları (birincil navigasyon) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        {STATUS_ORDER.map((k) => {
          const m = STATUS_META[k]; const Icon = m.icon; const active = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)}
              className={`text-left rounded-xl border p-3 transition-all ${active ? `ring-2 ${m.ring} border-transparent` : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'}`}>
              <div className="flex items-center justify-between">
                <Icon className={`w-4 h-4 ${m.accent}`} />
                <span className={`text-2xl font-bold ${active ? m.accent : 'text-gray-900'}`}>{counts[k] ?? 0}</span>
              </div>
              <div className="mt-1.5 text-sm font-semibold text-gray-800">{m.label}</div>
              <div className="text-[11px] text-gray-400 leading-tight mt-0.5">{m.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Alt filtreler: depo + pazar yeri + stok-eksik */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {(['ALL', 'SHOWROOM', 'NJ'] as const).map((w) => (
            <button key={w} onClick={() => setWhFilter(w)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${whFilter === w ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {w === 'ALL' ? 'Tüm Depolar' : whLabel(w)} <span className="opacity-70">({whCounts[w]})</span>
            </button>
          ))}
        </div>
        {mpOptions.length > 0 && (
          <select value={mpFilter} onChange={(e) => setMpFilter(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700">
            <option value="ALL">Tüm Pazar Yerleri</option>
            {mpOptions.map((mp) => <option key={mp} value={mp}>{mp}</option>)}
          </select>
        )}
        <div className="flex-1" />
        {counts.bekleyenStokYok ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> {counts.bekleyenStokYok} aday stok/iwasku eksik (gizli)
          </span>
        ) : null}
      </div>

      {/* Mesaj / hata */}
      {msg && <div className="mb-3 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 whitespace-pre-wrap">{msg}</div>}
      {error && <div className="mb-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {/* Bulk aksiyon barı */}
      {selectable && (
        <div className="flex items-center justify-between mb-2 min-h-[40px]">
          <div className="text-sm text-gray-500">{selected.size > 0 ? `${selected.size} sipariş seçili` : `${rows.length} sipariş`}</div>
          {tab === 'onayBekliyor' && (
            <button onClick={doApprove} disabled={busy || selected.size === 0} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <CheckCircle2 className="w-4 h-4" /> Onayla {selected.size > 0 && `(${selected.size})`}
            </button>
          )}
          {tab === 'cikisBekliyor' && (
            <button onClick={printSelected} disabled={selected.size === 0} title="Seçili siparişlerin etiketlerini depo bazında birleşik PDF olarak indir" className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <Printer className="w-4 h-4" /> Hazır Etiketleri Yazdır {selected.size > 0 && `(${selected.size})`}
            </button>
          )}
          {tab === 'kapatmaBekliyor' && (
            <button onClick={doClose} disabled={busy || selected.size === 0} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <Send className="w-4 h-4" /> Wisersell&apos;de Kapat {selected.size > 0 && `(${selected.size})`}
            </button>
          )}
        </div>
      )}

      {/* Tablo */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                {selectable && <th className="px-3 py-2.5 w-10"><input type="checkbox" className="rounded" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} /></th>}
                <th className="px-3 py-2.5">Sipariş No</th>
                <th className="px-3 py-2.5">Pazar Yeri</th>
                <th className="px-3 py-2.5">Depo</th>
                <th className="px-3 py-2.5">Alıcı / Adres</th>
                <th className="px-3 py-2.5">Ürünler</th>
                {tab !== 'onayBekliyor' && <th className="px-3 py-2.5">Tracking</th>}
                <th className="px-3 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-gray-400">Yükleniyor…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-gray-400">Bu durumda kayıt yok.</td></tr>
              ) : rows.map((r) => {
                const key = rowKey(r);
                const sel = selected.has(key);
                return (
                  <tr key={key} onClick={() => setDetailRow(r)} className={`cursor-pointer hover:bg-gray-50/70 ${sel ? 'bg-emerald-50/40' : ''}`}>
                    {selectable && <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="rounded" checked={sel} onChange={() => toggle(key)} /></td>}
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-gray-900">{r.orderCode ?? r.orderNumber}</div>
                      {r.labelNo && <div className="text-[11px] text-gray-400">etiket {r.labelNo}</div>}
                      {r.readyPending && <span className="mt-0.5 inline-block text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">ready-pending</span>}
                    </td>
                    <td className="px-3 py-2.5"><span className="inline-block text-xs font-medium px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-100">{r.marketplaceCode ?? '—'}</span></td>
                    <td className="px-3 py-2.5"><span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-md border ${whBadge(r.warehouse)}`}>{whLabel(r.warehouse)}</span></td>
                    <td className="px-3 py-2.5 max-w-xs">
                      <div className="font-medium text-gray-800">{r.recipientName ?? (r.addressNote ? r.addressNote.split('\n')[1] ?? '' : '—')}</div>
                      {(r.shipAddress || r.addressNote) && (
                        <div className="text-[11px] text-gray-500 whitespace-pre-line leading-snug flex items-start gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-gray-400" />
                          <span>{r.shipAddress ?? r.addressNote}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 max-w-sm">
                      <span className="line-clamp-2" title={itemsText(r.items)}>{itemsText(r.items)}</span>
                    </td>
                    {tab !== 'onayBekliyor' && <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{r.trackingNumber ?? '—'}</td>}
                    <td className="px-3 py-2.5 text-right text-gray-300"><ChevronRight className="w-4 h-4 inline" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Genel sipariş detay modalı (Cargolens tarzı): tüm bilgi + etiket + aksiyon tek yerde */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => { setDetailRow(null); load(); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
            {/* Başlık */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <div className="flex items-center gap-2.5">
                <span className={`w-2.5 h-2.5 rounded-full ${STATUS_META[tab].dot}`} />
                <div>
                  <div className="font-bold text-gray-900">{detailRow.orderCode ?? detailRow.orderNumber}</div>
                  <div className="text-xs text-gray-500">{STATUS_META[tab].label}</div>
                </div>
              </div>
              <button onClick={() => { setDetailRow(null); load(); }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 max-h-[72vh] overflow-y-auto space-y-4">
              {/* Üst bilgi şeridi */}
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-[11px] text-gray-400 uppercase">Pazar Yeri</div><span className="inline-block mt-0.5 text-xs font-medium px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-100">{detailRow.marketplaceCode ?? '—'}</span></div>
                <div><div className="text-[11px] text-gray-400 uppercase">Depo</div><span className={`inline-block mt-0.5 text-xs font-medium px-2 py-0.5 rounded-md border ${whBadge(detailRow.warehouse)}`}>{whLabel(detailRow.warehouse)}</span></div>
                <div><div className="text-[11px] text-gray-400 uppercase">Tracking</div><div className="mt-0.5 font-mono text-xs text-gray-700">{detailRow.trackingNumber ?? '—'}</div></div>
              </div>

              {/* Alıcı / adres */}
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                <div className="text-[11px] text-gray-400 uppercase mb-1">Alıcı / Adres</div>
                <div className="font-medium text-gray-800">{detailRow.recipientName ?? (detailRow.addressNote ? detailRow.addressNote.split('\n')[1] ?? '' : '—')}</div>
                {(detailRow.shipAddress || detailRow.addressNote) && (
                  <div className="text-xs text-gray-600 whitespace-pre-line leading-snug flex items-start gap-1 mt-1">
                    <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" /><span>{detailRow.shipAddress ?? detailRow.addressNote}</span>
                  </div>
                )}
              </div>

              {/* Ürünler */}
              <div>
                <div className="text-[11px] text-gray-400 uppercase mb-1">Ürünler</div>
                <ul className="text-sm text-gray-700 space-y-0.5">
                  {(detailRow.items ?? []).map((i, ix) => (
                    <li key={ix} className="flex justify-between gap-3 border-b border-gray-50 py-1">
                      <span>{i.name ?? i.product_name ?? i.iwasku}</span>
                      <span className="text-gray-400 shrink-0">×{i.qty ?? i.quantity ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Etiket (outbound siparişlerde) — yükle/görüntüle/yazdır */}
              {tab !== 'onayBekliyor' && detailRow.warehouse && detailRow.id && (
                <div className="rounded-lg border border-gray-100 p-3">
                  <div className="text-[11px] text-gray-400 uppercase mb-2 flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> Kargo Etiketi</div>
                  <LabelUploader warehouseCode={detailRow.warehouse} orderId={detailRow.id} role="ADMIN" />
                </div>
              )}
            </div>

            {/* Aksiyon footer — duruma göre */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50/50">
              <button onClick={() => { setDetailRow(null); load(); }} className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700">Kapat</button>
              {tab === 'onayBekliyor' && (
                <button onClick={() => approveOne(detailRow.wisersellOrderId)} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                  <CheckCircle2 className="w-4 h-4" /> Onayla
                </button>
              )}
              {tab === 'cikisBekliyor' && (
                <button onClick={() => setShipOrder(detailRow)} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">
                  <Truck className="w-4 h-4" /> Çıkış Yap (FIFO)
                </button>
              )}
              {tab === 'kapatmaBekliyor' && (
                <button onClick={() => closeOne(detailRow.id)} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                  <Send className="w-4 h-4" /> Wisersell&apos;de Kapat
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Çıkış (ShipModal — FIFO tahsis + SHIPPED), detay modalinden tetiklenir */}
      {shipOrder?.warehouse && shipOrder.id && (
        <ShipModal
          isOpen
          warehouseCode={shipOrder.warehouse}
          orderId={shipOrder.id}
          orderNumber={shipOrder.orderNumber ?? shipOrder.orderCode ?? ''}
          onClose={() => setShipOrder(null)}
          onSuccess={() => { setShipOrder(null); setDetailRow(null); load(); }}
        />
      )}
    </div>
  );
}
