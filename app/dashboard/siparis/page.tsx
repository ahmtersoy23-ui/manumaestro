'use client';

/**
 * Birleşik Sipariş ekranı (top-level "Sipariş" ana tab) — Faz 1: SADECE süper-admin.
 * Wisersell → ManuMaestro otomasyonunun kontrol kulesi: Onay + Kapatma + izleme.
 * Per-warehouse /siparis akışına dokunmaz; operatör etiket/çıkışı orada yapar.
 * region: ülke-genişletilebilir (şimdi US).
 */

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Zap, CheckCircle2, PackageCheck, Truck, Send, Archive, AlertTriangle, MapPin, Printer, FileText, X, ChevronRight, Copy, Check, Plus, Warehouse, Download, Tag, Bell, Calculator } from 'lucide-react';
import { LabelUploader } from '@/components/wms/LabelUploader';
import { ShipModal } from '@/components/wms/ShipModal';
import { ManualOrderModal } from '@/components/siparis/ManualOrderModal';
import VeeqoLabelModal from '@/components/siparis/VeeqoLabelModal';
import RateQuoteModal from '@/components/siparis/RateQuoteModal';

type StatusKey = 'onayBekliyor' | 'eslesmeGerek' | 'etiketBekliyor' | 'cikisBekliyor' | 'cgBekliyor' | 'wayfairBekliyor' | 'kapatmaBekliyor' | 'kapandi';

const STATUS_META: Record<StatusKey, { label: string; desc: string; icon: typeof CheckCircle2; accent: string; ring: string; dot: string }> = {
  onayBekliyor:   { label: 'Onay Bekliyor',    desc: 'US stoğu teyitli, onay bekliyor', icon: CheckCircle2, accent: 'text-emerald-700', ring: 'ring-emerald-500 bg-emerald-50', dot: 'bg-emerald-500' },
  eslesmeGerek:   { label: 'Eşleşme Gerek',    desc: 'iwasku eşleşmiyor — mapping gerek', icon: AlertTriangle, accent: 'text-orange-700', ring: 'ring-orange-500 bg-orange-50', dot: 'bg-orange-500' },
  etiketBekliyor: { label: 'Etiket Bekliyor',  desc: 'Onaylandı, kargo etiketi bekliyor', icon: PackageCheck, accent: 'text-amber-700',  ring: 'ring-amber-500 bg-amber-50',   dot: 'bg-amber-500' },
  cikisBekliyor:  { label: 'Çıkış Bekliyor',   desc: 'Etiketli, fiziksel çıkış bekliyor', icon: Truck,        accent: 'text-sky-700',    ring: 'ring-sky-500 bg-sky-50',       dot: 'bg-sky-500' },
  cgBekliyor:     { label: 'CG Bekliyor',      desc: 'CastleGate — MCF/tracking bekliyor', icon: Warehouse,  accent: 'text-teal-700',   ring: 'ring-teal-500 bg-teal-50',     dot: 'bg-teal-500' },
  wayfairBekliyor:{ label: 'Wayfair',          desc: 'Dropship — depo çıkışı + tracking (etiket yok)', icon: Tag, accent: 'text-fuchsia-700', ring: 'ring-fuchsia-500 bg-fuchsia-50', dot: 'bg-fuchsia-500' },
  kapatmaBekliyor:{ label: 'Kapatma Bekliyor', desc: 'Kargolandı, Wisersell kapatma',   icon: Send,         accent: 'text-rose-700',   ring: 'ring-rose-500 bg-rose-50',     dot: 'bg-rose-500' },
  kapandi:        { label: 'Kapandı',          desc: 'Wisersell external-close yazıldı', icon: Archive,      accent: 'text-slate-600',  ring: 'ring-slate-400 bg-slate-50',   dot: 'bg-slate-400' },
};
// 'eslesmeGerek' kart değil — stokYok gibi bir istisna durumu, filtre barında rozet (STATUS_META'da kalır: modal/dot kullanır).
const STATUS_ORDER: StatusKey[] = ['onayBekliyor', 'etiketBekliyor', 'cikisBekliyor', 'cgBekliyor', 'wayfairBekliyor', 'kapatmaBekliyor', 'kapandi'];

const WH = {
  SHOWROOM:   { label: 'Fairfield',  badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NJ:         { label: 'Somerset',   badge: 'bg-sky-50 text-sky-700 border-sky-200' },
  CG_SHUKRAN: { label: 'Shukran CG', badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  CG_MDN:     { label: 'MDN CG',     badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
} as const;
function whLabel(w?: string) { return w && w in WH ? WH[w as keyof typeof WH].label : (w ?? '—'); }
function whBadge(w?: string) { return w && w in WH ? WH[w as keyof typeof WH].badge : 'bg-gray-50 text-gray-600 border-gray-200'; }
/** Sipariş tarihi (kısa, tr) — yaş fikri versin. */
function fmtDate(d?: string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Tek tıkla kopyalanabilir etiketli alan (detay modalinde alıcı/adres). */
function CopyField({ label, value, icon, multiline }: { label: string; value?: string | null; icon?: ReactNode; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = (value ?? '').trim();
  const copy = async () => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard izni yok */ }
  };
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[11px] text-gray-400 uppercase">{label}</div>
        {text && (
          <button onClick={copy} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-700 transition-colors">
            {copied ? <><Check className="w-3 h-3 text-emerald-600" /> Kopyalandı</> : <><Copy className="w-3 h-3" /> Kopyala</>}
          </button>
        )}
      </div>
      <div className={`text-sm text-gray-800 flex items-start gap-1 ${multiline ? 'leading-snug' : 'font-medium'}`}>
        {icon && <span className="mt-0.5 shrink-0 text-gray-400">{icon}</span>}
        <span className={multiline ? 'whitespace-pre-line' : ''}>{text || '—'}</span>
      </div>
    </div>
  );
}

interface Dims { lengthIn: number | null; widthIn: number | null; heightIn: number | null; weightLb: number | null; }
interface ItemLite { iwasku: string | null; qty?: number; quantity?: number; name?: string | null; product_name?: string | null; fnsku?: string | null; dims?: Dims | null; }
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
  marketplaceLabel?: string | null;
  source?: 'MANUAL' | 'WISERSELL_AUTO';
  createdBy?: { name: string; email: string } | null;
  trackingNumber?: string | null;
  manualTracking?: string | null;
  labelId?: string | null;
  veeqoShipmentId?: string | null;
  labelCost?: number | null;
  labelCostCurrency?: string | null;
  labelService?: string | null;
  cgExportedAt?: string | null; // CG MCF Excel alındı mı
  amazonCancelledAt?: string | null; // Amazon'da iptal (SP-API canlı kontrol)
  readyPending?: boolean;
  manualSource?: boolean;         // mobilya / Amazon Citi → onayda manuel kaynak seçimi (TR/depo)
  sourceOptions?: string[];       // karşılayan depolar: SHOWROOM/NJ/CG_SHUKRAN/CG_MDN
  createdAt?: string | null;
  items?: ItemLite[];
  unresolved?: Array<{ product_code?: string | null; marketplace_sku?: string | null; title?: string | null }>;
}
interface BoardData {
  counts: Record<string, number>;
  data: Record<StatusKey, Row[]>;
  orderLevel?: 'NONE' | 'APPROVER' | 'CREATOR' | 'FULL';
  canApprove?: boolean;     // Onayla / auto-run / Kapat / Listeden Düş / CG-rutin
  canCreateOrder?: boolean; // Manuel Giriş
  canLabelDelete?: boolean; // Veeqo Etiket Al / Manuel Sil / Açığa Al / Etiketi İptal
}

/**
 * Bildirim zili — kullanıcı tercihine göre (localStorage) Etiket Bekliyor / Çıkış Bekliyor
 * kovalarına YENİ sipariş düşünce sesli (WebAudio) + tarayıcı bildirimi verir. ~45 sn poll;
 * yalnız bu sekme açıkken çalışır (push değil). Ana board state'ine dokunmaz (bağımsız fetch).
 */
type NotifPrefs = { enabled: boolean; sound: boolean; etiket: boolean; cikis: boolean };
const NOTIF_KEY = 'siparis_notif_prefs';
const NOTIF_DEFAULT: NotifPrefs = { enabled: false, sound: true, etiket: true, cikis: false };

function NotificationBell({ region }: { region: string }) {
  const [prefs, setPrefs] = useState<NotifPrefs>(() => {
    if (typeof window === 'undefined') return NOTIF_DEFAULT;
    try { const s = localStorage.getItem(NOTIF_KEY); return s ? { ...NOTIF_DEFAULT, ...JSON.parse(s) } : NOTIF_DEFAULT; } catch { return NOTIF_DEFAULT; }
  });
  const [open, setOpen] = useState(false);
  const seenRef = useRef<Set<string> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  const save = (p: NotifPrefs) => { setPrefs(p); try { localStorage.setItem(NOTIF_KEY, JSON.stringify(p)); } catch { /* kota */ } };

  const beep = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = audioRef.current ?? new Ctx();
      audioRef.current = ctx;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.12;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.25);
    } catch { /* ses yoksa sessiz geç */ }
  }, []);

  const fire = useCallback((n: number, label: string) => {
    if (prefs.sound) beep();
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Yeni sipariş', { body: `${label}: ${n} yeni sipariş düştü` });
      }
    } catch { /* bildirim yoksa sessiz */ }
  }, [prefs.sound, beep]);

  // Poll: izlenen kovaların id'lerini ~45 sn'de bir kontrol et, yeni id → bildir.
  useEffect(() => {
    if (!prefs.enabled || (!prefs.etiket && !prefs.cikis)) { seenRef.current = null; return; }
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/siparis/board?region=${region}`, { credentials: 'include' });
        const j = await res.json();
        if (stop || !j?.success) return;
        const ids: string[] = [];
        if (prefs.etiket) ids.push(...(j.data?.etiketBekliyor ?? []).map((r: { id?: string }) => r.id).filter(Boolean));
        if (prefs.cikis) ids.push(...(j.data?.cikisBekliyor ?? []).map((r: { id?: string }) => r.id).filter(Boolean));
        const cur = new Set(ids);
        if (seenRef.current == null) { seenRef.current = cur; return; } // ilk tur = baz çizgi (bildirme)
        const fresh = ids.filter((id) => !seenRef.current!.has(id));
        seenRef.current = cur;
        if (fresh.length) {
          const lbl = [prefs.etiket && 'Etiket Bekliyor', prefs.cikis && 'Çıkış Bekliyor'].filter(Boolean).join(' / ');
          fire(fresh.length, lbl);
        }
      } catch { /* ağ hatası — sessiz, sonraki tur dener */ }
    };
    tick();
    const iv = setInterval(tick, 45_000);
    return () => { stop = true; clearInterval(iv); };
  }, [prefs.enabled, prefs.etiket, prefs.cikis, region, fire]);

  const toggleEnable = async () => {
    if (!prefs.enabled) {
      try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission(); } catch { /* izin reddi */ }
      beep(); // kullanıcı jestiyle AudioContext'i başlat (sonraki beep'ler için)
      seenRef.current = null;
    }
    save({ ...prefs, enabled: !prefs.enabled });
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Bildirim ayarları"
        className={`inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border ${prefs.enabled ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
        <Bell className="w-4 h-4" /> {prefs.enabled ? 'Bildirim açık' : 'Bildirim'}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-40 text-sm space-y-2">
          <label className="flex items-center justify-between cursor-pointer"><span>Bildirim</span><input type="checkbox" checked={prefs.enabled} onChange={toggleEnable} /></label>
          <label className="flex items-center justify-between cursor-pointer"><span>Ses</span><input type="checkbox" checked={prefs.sound} onChange={(e) => save({ ...prefs, sound: e.target.checked })} /></label>
          <div className="text-[11px] text-gray-400 uppercase pt-1">İzlenen kovalar</div>
          <label className="flex items-center justify-between cursor-pointer"><span>Etiket Bekliyor</span><input type="checkbox" checked={prefs.etiket} onChange={(e) => save({ ...prefs, etiket: e.target.checked })} /></label>
          <label className="flex items-center justify-between cursor-pointer"><span>Çıkış Bekliyor</span><input type="checkbox" checked={prefs.cikis} onChange={(e) => save({ ...prefs, cikis: e.target.checked })} /></label>
          <div className="text-[10px] text-gray-400 pt-1 leading-snug">Yalnız bu sekme açıkken çalışır · ~45 sn&apos;de bir kontrol. Yeni sipariş görmek için Sayfayı Yenile.</div>
        </div>
      )}
    </div>
  );
}

export default function SiparisPage() {
  const [region] = useState('US');
  const [board, setBoard] = useState<BoardData | null>(null);
  const [tab, setTab] = useState<StatusKey>('onayBekliyor');
  const [whFilter, setWhFilter] = useState<'ALL' | 'SHOWROOM' | 'NJ' | 'CG_SHUKRAN' | 'CG_MDN'>('ALL');
  const [mpFilter, setMpFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  // Manuel kaynak seçimi (mobilya / Amazon Citi): wisersellOrderId → 'TR' | depo. Boşsa TR.
  const [manualSrc, setManualSrc] = useState<Record<number, string>>({});
  const [shipOrder, setShipOrder] = useState<Row | null>(null);
  const [veeqoOrder, setVeeqoOrder] = useState<Row | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  // CG MCF export — eşleşmeyen part number kuyruğu (export'u engeller; operatör burada eşler)
  const [unmatched, setUnmatched] = useState<Array<{ iwasku: string; productName: string | null; orderNumbers: string[] }> | null>(null);
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});
  const [exportIds, setExportIds] = useState<string[]>([]); // mapping sonrası tekrar denemek için
  // CG detay modalinde manuel tracking girişi
  const [trackingDraft, setTrackingDraft] = useState('');
  const [costDraft, setCostDraft] = useState(''); // Veeqo-dışı etiket bedeli (elle)

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
  // Sipariş board kademeli yetki (shelf'ten bağımsız): APPROVER < CREATOR < FULL
  const canApprove = board?.canApprove ?? false;       // Onayla / auto-run / Kapat / Listeden Düş / CG-rutin
  const canCreateOrder = board?.canCreateOrder ?? false; // Manuel Giriş
  const canLabelDelete = board?.canLabelDelete ?? false; // Veeqo Etiket Al / Manuel Sil / Açığa Al / Etiketi İptal
  const tabRows = useMemo(() => board?.data[tab] ?? [], [board, tab]);

  // Warehouse sayıları (aktif tab) + marketplace seçenekleri — client-side
  const whCounts = useMemo(() => {
    const c = { ALL: tabRows.length, SHOWROOM: 0, NJ: 0, CG_SHUKRAN: 0, CG_MDN: 0 };
    for (const r of tabRows) {
      if (r.warehouse === 'SHOWROOM') c.SHOWROOM++;
      else if (r.warehouse === 'NJ') c.NJ++;
      else if (r.warehouse === 'CG_SHUKRAN') c.CG_SHUKRAN++;
      else if (r.warehouse === 'CG_MDN') c.CG_MDN++;
    }
    return c;
  }, [tabRows]);
  const mpOptions = useMemo(() => [...new Set(tabRows.map((r) => r.marketplaceCode).filter(Boolean) as string[])].sort(), [tabRows]);
  // marketplaceCode → dostça ad (Wisersell kodu tabloda yoksa kodun kendisi)
  const mpLabelByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of tabRows) if (r.marketplaceCode) m.set(r.marketplaceCode, r.marketplaceLabel || r.marketplaceCode);
    return m;
  }, [tabRows]);

  const rows = useMemo(() => tabRows.filter((r) =>
    (whFilter === 'ALL' || r.warehouse === whFilter) &&
    (mpFilter === 'ALL' || r.marketplaceCode === mpFilter)
  ), [tabRows, whFilter, mpFilter]);

  // İlk onay (bootstrap) + çıkış etiket yazdırma → herkes; kapatma + CG (Wisersell) → Manager+.
  const selectable = (tab === 'onayBekliyor' && canApprove) || tab === 'cikisBekliyor' || ((tab === 'kapatmaBekliyor' || tab === 'cgBekliyor') && canApprove);
  const rowKey = useCallback((r: Row) => (tab === 'onayBekliyor' ? String(r.wisersellOrderId) : String(r.id)), [tab]);

  const toggle = (k: string) => setSelected((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  // CG Bekliyor'da "Tümünü Seç" Excel'i ALINMIŞ siparişleri dahil etmez (çift MCF önleme).
  // Alınanlar yine elle tek tek seçilebilir (yeniden indirme gerekirse).
  const toggleAll = () => setSelected((p) => {
    const pickable = rows.filter((r) => !(tab === 'cgBekliyor' && r.cgExportedAt));
    return p.size >= pickable.length && pickable.length > 0 ? new Set() : new Set(pickable.map(rowKey));
  });

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
  // Manuel-kaynak satırları için seçilen kaynağı (TR/depo) topla; diğer id'lerde gönderme (otomatik routing).
  const buildSources = (ids: number[]): Record<string, string> | undefined => {
    const onay = board?.data.onayBekliyor ?? [];
    const out: Record<string, string> = {};
    for (const id of ids) {
      const row = onay.find((r) => r.wisersellOrderId === id);
      if (row?.manualSource) out[String(id)] = manualSrc[id] ?? 'TR';
    }
    return Object.keys(out).length ? out : undefined;
  };
  const approveMsg = (j: { [k: string]: unknown }) => {
    const ap = Number(j.approved ?? 0), tr = Number(j.dismissedTr ?? 0);
    return [ap ? `${ap} onaylandı` : '', tr ? `${tr} TR'ye düştü` : ''].filter(Boolean).join(', ') + '.' || 'İşlendi.';
  };
  const doApprove = () => { const ids = [...selected].map(Number).filter(Boolean); runAction('/api/siparis/approve', { wisersellOrderIds: ids, sources: buildSources(ids) }, approveMsg); };
  const approveOne = async (id?: number) => { if (!id) return; await runAction('/api/siparis/approve', { wisersellOrderIds: [id], sources: buildSources([id]) }, approveMsg); setDetailRow(null); };
  const closeOne = async (id?: string) => { if (!id) return; await runAction('/api/siparis/close', { orderIds: [id] }, (j) => `${j.closed} kapatıldı.`); setDetailRow(null); };
  const doClose = () => runAction('/api/siparis/close', { orderIds: [...selected] }, (j) => {
    const failed = ((j.results as { ok: boolean; message?: string }[]) || []).filter((r) => !r.ok);
    return `${j.closed} kapatıldı.${failed.length ? ` ${failed.length} başarısız: ${failed.map((f) => f.message).join('; ')}` : ''}`;
  });
  const doAutoRun = () => runAction(`/api/siparis/auto-run?region=${region}`, {}, (j) => `Otomatik: ${j.approved} onaylandı.`);
  // Amazon'da iptal edilmiş siparişi listeden düş (DRAFT → CANCELLED). Operatör onayı.
  const dropOne = async (id?: string) => {
    if (!id) return;
    if (!window.confirm('Bu sipariş Amazon’da iptal edilmiş. Listeden düşürülsün mü? (Manu CANCELLED + Wisersell iptal)')) return;
    await runAction('/api/siparis/cancel', { orderIds: [id] }, (j) => {
      const failed = (j.wisersellFailed as string[]) ?? [];
      return `${j.cancelled} listeden düşürüldü${j.wisersellCancelled ? `, Wisersell'de ${j.wisersellCancelled} iptal` : ''}.${failed.length ? ` ⚠ WS başarısız: ${failed.join('; ')}` : ''}`;
    });
    setDetailRow(null);
  };
  // Onaylı (DRAFT) siparişi tekrar "açık"a al — Onay Bekliyor'a döner + Wisersell open.
  const reopenOne = async (id?: string) => {
    if (!id) return;
    if (!window.confirm('Sipariş "açık"a alınsın mı? Onay Bekliyor’a döner, Wisersell’de "açık" yapılır. (Etiket alınmamış olmalı)')) return;
    await runAction('/api/siparis/reopen', { orderId: id }, (j) =>
      `Sipariş açığa alındı — Onay Bekliyor.${j.wisersellReopened ? ' Wisersell: açık.' : (j.wisersellError ? ` ⚠ Wisersell: ${j.wisersellError}` : '')}`,
    );
    setDetailRow(null);
  };
  // Manuel girilmiş (source=MANUAL) DRAFT siparişi tamamen sil. reopen ucu MANUAL'de
  // Wisersell'e dokunmadan yalnız outbound kaydı siler (cascade items/labels).
  const deleteManualOne = async (id?: string) => {
    if (!id) return;
    if (!window.confirm('Bu manuel sipariş tamamen silinsin mi? Geri alınamaz. (Etiket alınmamış olmalı)')) return;
    await runAction('/api/siparis/reopen', { orderId: id }, () => 'Manuel sipariş silindi.');
    setDetailRow(null);
  };
  // Alınmış Veeqo etiketini iptal et (Veeqo'da void+iade) → Etiket Bekliyor'a döner.
  const cancelVeeqoOne = async (id?: string) => {
    if (!id) return;
    if (!window.confirm('Veeqo etiketi iptal edilsin mi? Veeqo’da void edilir (iade) ve sipariş Etiket Bekliyor’a döner. Kargo yola çıktıysa Veeqo iptali reddedebilir.')) return;
    await runAction('/api/siparis/veeqo-cancel', { orderId: id }, (j) => `Etiket iptal edildi (iade)${j.trackingNumber ? ` — ${j.trackingNumber}` : ''}. Etiket Bekliyor’a döndü.`);
    setDetailRow(null);
  };

  // ── CG / Wayfair MCF export + eşleştirme + manuel tracking ──────────────────
  const downloadBase64Xlsx = (filename: string, b64: string) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const runExport = useCallback(async (ids: string[]) => {
    if (!ids.length) { setMsg('Önce sipariş seçin.'); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/siparis/cg-export', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds: ids }) });
      const json = await res.json();
      if (res.status === 409 && json.unmatched) {
        setExportIds(ids); setUnmatched(json.unmatched); setMapDraft({});
        return;
      }
      if (!res.ok || !json.success) throw new Error(json.error || 'Export hatası');
      const files = (json.files ?? []) as Array<{ filename: string; base64: string; account: string; rowCount: number }>;
      for (const f of files) downloadBase64Xlsx(f.filename, f.base64);
      setUnmatched(null);
      setMsg(`${files.length} MCF dosyası indirildi (${files.map((f) => `${f.account}: ${f.rowCount} satır`).join(', ')}).`);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Hata'); } finally { setBusy(false); }
  }, []);

  const doExport = () => runExport([...selected]);

  const submitMappings = async () => {
    const entries = Object.entries(mapDraft).map(([iw, pn]) => [iw, pn.trim()] as const).filter(([, pn]) => pn);
    if (!entries.length) { setMsg('En az bir part number girin.'); return; }
    setBusy(true); setMsg(null);
    try {
      for (const [iwasku, partNumber] of entries) {
        const res = await fetch('/api/siparis/wayfair-map', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partNumber, iwasku }) });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `Mapping yazılamadı (${iwasku})`);
      }
      await runExport(exportIds); // hepsi eşleştiyse dosya iner; eksik kaldıysa kalan liste döner
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Hata'); setBusy(false); }
  };

  const saveTracking = async (orderId?: string) => {
    if (!orderId || !trackingDraft.trim()) return;
    await runAction('/api/siparis/cg-tracking', { orderId, tracking: trackingDraft.trim() }, () => 'Tracking kaydedildi.');
    setTrackingDraft(''); setDetailRow(null);
  };

  const runClosedExport = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/siparis/export-closed', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || 'Export hatası');
      for (const f of (j.files ?? []) as Array<{ filename: string; base64: string; rowCount: number }>) downloadBase64Xlsx(f.filename, f.base64);
      setMsg(`${j.files?.[0]?.rowCount ?? 0} kapanan sipariş indirildi.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Export hatası'); }
    finally { setBusy(false); }
  };

  const saveCost = async (orderId?: string) => {
    if (!orderId) return;
    const v = parseFloat(costDraft.replace(',', '.'));
    if (!isFinite(v) || v < 0) { setMsg('Geçerli bir bedel girin'); return; }
    await runAction('/api/siparis/label-cost', { orderId, cost: v }, () => 'Etiket bedeli kaydedildi.');
    setDetailRow(null);
  };

  const openDetail = (r: Row) => { setDetailRow(r); setTrackingDraft(r.manualTracking ?? ''); setCostDraft(r.labelCost != null ? String(r.labelCost) : ''); };

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

  // Tabloda kısa konum: adres metnindeki "STATE ZIP" satırı (eyalet+zip) + ülke. Tam adres modalde.
  const shortLoc = (r: Row): string => {
    const src = r.shipAddress ?? r.addressNote ?? '';
    const m = src.split('\n').find((l) => /[A-Z]{2}\s+\d{5}/.test(l));
    return m ? `${m.trim()} · US` : '';
  };

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
          <NotificationBell region={region} />
          {canApprove && (
            <button onClick={() => setRateOpen(true)} title="Ölçü + adres girip Veeqo kargo fiyatlarını sorgula (etiket almaz, para çekmez)" className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700">
              <Calculator className="w-4 h-4" /> Kargo Fiyat
            </button>
          )}
          <button onClick={load} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Sayfayı Yenile
          </button>
          {canCreateOrder && (
            <button onClick={() => setManualOpen(true)} title="Wisersell'de olmayan, etiketi başka platformdan alınan siparişi elle ekle" className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700">
              <Plus className="w-4 h-4" /> Manuel Giriş
            </button>
          )}
          {canApprove && (
            <button onClick={doAutoRun} disabled={busy} title="WISERSELL_AUTO_APPROVE açıksa tüm uygun adayları onaylar" className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              <Zap className="w-4 h-4" /> Tümünü Onayla
            </button>
          )}
        </div>
      </div>

      {/* Durum kartları (birincil navigasyon) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
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
          {(['ALL', 'SHOWROOM', 'NJ', 'CG_SHUKRAN', 'CG_MDN'] as const)
            .filter((w) => w === 'ALL' || w === 'SHOWROOM' || w === 'NJ' || whCounts[w] > 0)
            .map((w) => (
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
            {mpOptions.map((mp) => <option key={mp} value={mp}>{mpLabelByCode.get(mp) ?? mp}</option>)}
          </select>
        )}
        <div className="flex-1" />
        {counts.eslesmeGerek ? (
          <button onClick={() => setTab('eslesmeGerek')}
            title="iwasku eşleşmiyor — mapping gerek. Eşleme eklenince otomatik Onay Bekliyor'a düşer."
            className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 border transition-colors ${tab === 'eslesmeGerek' ? 'bg-orange-500 text-white border-orange-500' : 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100'}`}>
            <AlertTriangle className="w-3.5 h-3.5" /> {counts.eslesmeGerek} eşleşme gerek
          </button>
        ) : null}
        {counts.stokYok ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5" title="iwasku eşleşti ama US deposunda yeterli stok yok — stok gelince görünür">
            <AlertTriangle className="w-3.5 h-3.5" /> {counts.stokYok} aday US stoğu yok (gizli)
          </span>
        ) : null}
      </div>

      {/* Mesaj / hata */}
      {msg && <div className="mb-3 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 whitespace-pre-wrap">{msg}</div>}
      {error && <div className="mb-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {/* Bulk aksiyon barı (+ Kapandı'da export) */}
      {(selectable || tab === 'kapandi') && (
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
          {tab === 'cgBekliyor' && (
            <div className="flex items-center gap-2">
              <button onClick={doExport} disabled={busy || selected.size === 0} title="Seçili CG siparişleri için Wayfair MCF Order Import Excel'i (Shukran/MDN ayrı) indir" className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed">
                <Download className="w-4 h-4" /> MCF Excel İndir {selected.size > 0 && `(${selected.size})`}
              </button>
              <button onClick={doClose} disabled={busy || selected.size === 0} title="Tracking girilmiş CG siparişlerini Wisersell'de kapat (external-close + platform kapama)" className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed">
                <Send className="w-4 h-4" /> Wisersell&apos;de Kapat {selected.size > 0 && `(${selected.size})`}
              </button>
            </div>
          )}
          {tab === 'kapandi' && (
            <button onClick={runClosedExport} disabled={busy} title="Kapanan siparişleri Excel olarak indir (sipariş, tarih, pazaryeri, alıcı, firma, servis, track, bedel)" className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed">
              <Download className="w-4 h-4" /> Excel İndir
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
                <th className="px-3 py-2.5">Alıcı / Konum</th>
                <th className="px-3 py-2.5">Ürün</th>
                <th className="px-3 py-2.5 text-center w-16">Adet</th>
                {tab !== 'onayBekliyor' && tab !== 'eslesmeGerek' && <th className="px-3 py-2.5">TRACKING</th>}
                <th className="px-3 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-gray-400">Yükleniyor…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-gray-400">Bu durumda kayıt yok.</td></tr>
              ) : rows.map((r) => {
                const key = rowKey(r);
                const sel = selected.has(key);
                return (
                  <tr key={key} onClick={() => openDetail(r)} className={`cursor-pointer hover:bg-gray-50/70 ${sel ? 'bg-emerald-50/40' : ''}`}>
                    {selectable && <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="rounded" checked={sel} onChange={() => toggle(key)} /></td>}
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-gray-900">{r.orderCode ?? r.orderNumber}</div>
                      {r.createdAt && <div className="text-[11px] text-gray-400 mt-0.5">{fmtDate(r.createdAt)}</div>}
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        {r.source === 'MANUAL' && <span className="inline-block text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">manuel giriş</span>}
                        {r.readyPending && <span className="inline-block text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">ready-pending</span>}
                        {tab === 'cgBekliyor' && r.cgExportedAt && <span className="inline-block text-[10px] font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5" title={`Excel alındı: ${fmtDate(r.cgExportedAt)}`}>Excel alındı</span>}
                        {r.amazonCancelledAt && <span className="inline-block text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5" title={`Amazon'da iptal: ${fmtDate(r.amazonCancelledAt)}`}>İptal (Amazon)</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><span title={r.marketplaceCode} className="inline-block text-xs font-medium px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-100">{r.marketplaceLabel || r.marketplaceCode || '—'}</span></td>
                    <td className="px-3 py-2.5" onClick={(e) => { if (tab === 'onayBekliyor' && r.manualSource) e.stopPropagation(); }}>
                      {tab === 'onayBekliyor' && r.manualSource && r.wisersellOrderId ? (
                        <select
                          value={manualSrc[r.wisersellOrderId] ?? 'TR'}
                          onChange={(e) => setManualSrc((s) => ({ ...s, [r.wisersellOrderId!]: e.target.value }))}
                          className="text-xs border border-amber-300 bg-amber-50 rounded-md px-1.5 py-1 text-gray-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
                          title="Kaynak seç (TR = board'dan düşer, Wisersell'de kalır)"
                        >
                          <option value="TR">TR (standart)</option>
                          {(r.sourceOptions ?? []).map((w) => <option key={w} value={w}>{whLabel(w)}</option>)}
                        </select>
                      ) : r.warehouse ? (
                        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-md border ${whBadge(r.warehouse)}`}>{whLabel(r.warehouse)}</span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-gray-800">{r.recipientName ?? (r.addressNote ? r.addressNote.split('\n')[1] ?? '' : '—')}</div>
                      <div className="text-[11px] text-gray-500">{shortLoc(r)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">
                      {tab === 'eslesmeGerek'
                        ? <div className="text-xs text-orange-700 space-y-1">{(r.unresolved ?? []).map((u, ix) => { const t = u.title || u.product_code || u.marketplace_sku || '?'; return <div key={ix} className="line-clamp-3 max-w-[300px] leading-snug" title={[u.title, u.product_code, u.marketplace_sku].filter(Boolean).join(' · ')}>{t}</div>; })}</div>
                        : <div className="space-y-1">{(r.items ?? []).map((i, ix) => { const nm = i.name ?? i.product_name ?? i.iwasku ?? '?'; return <div key={ix} className="max-w-[300px]"><div className="line-clamp-3 leading-snug" title={nm}>{nm}</div>{i.fnsku && <div className="text-[11px] font-mono text-gray-500 leading-tight">{i.fnsku}</div>}</div>; })}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-500">
                      <div className="space-y-0.5">{(r.items ?? []).map((i, ix) => <div key={ix}>{i.qty ?? i.quantity ?? 0}</div>)}</div>
                    </td>
                    {tab !== 'onayBekliyor' && tab !== 'eslesmeGerek' && <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{r.trackingNumber ?? '—'}</td>}
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
                  <div className="text-xs text-gray-500 flex items-center gap-1.5">
                    {STATUS_META[tab].label}
                    {detailRow.createdAt && <span className="text-gray-400">· {fmtDate(detailRow.createdAt)}</span>}
                    {detailRow.createdBy && <span className="text-gray-400" title={detailRow.createdBy.email}>· {detailRow.createdBy.name}</span>}
                    {detailRow.source === 'MANUAL' && <span className="inline-block text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">manuel giriş</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => { setDetailRow(null); load(); }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 max-h-[72vh] overflow-y-auto space-y-4">
              {detailRow.amazonCancelledAt && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Amazon&apos;da iptal edilmiş</div>
                  <div className="mt-1 text-xs">Bu sipariş Amazon&apos;da iptal edilmiş (canlı SP-API kontrolü). Etiket/çıkış/MCF <strong>yapmayın</strong> — <strong>Listeden Düş</strong> ile kaldırın (Wisersell&apos;de de iptal edilir).</div>
                </div>
              )}
              {tab === 'eslesmeGerek' && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                  <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> iwasku eşleşmesi yok — mapping gerekli</div>
                  <div className="mt-1 text-xs">Bu siparişin ürünü iwasku ile eşleşmiyor. DataBridge <code className="bg-orange-100 px-1 rounded">wisersell_sku_mappings</code>&apos;e eşleme eklenince otomatik Onay Bekliyor&apos;a düşer. Eşleşmeyen:</div>
                  <ul className="mt-1 text-xs font-mono space-y-0.5">
                    {(detailRow.unresolved ?? []).map((u, ix) => <li key={ix}>{u.title || '—'} {u.product_code ? `· ${u.product_code}` : ''} {u.marketplace_sku ? `· ${u.marketplace_sku}` : ''}</li>)}
                  </ul>
                </div>
              )}
              {tab === 'cgBekliyor' && (
                <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800 space-y-2">
                  <div className="font-semibold flex items-center gap-1.5"><Warehouse className="w-4 h-4" /> CastleGate (Wayfair MCF)</div>
                  <div className="text-xs">Etiket/shelf çıkışı yok. Akış: <strong>MCF Excel indir</strong> → Wayfair&apos;e yükle → sevk edince MCF raporundaki tracking&apos;i aşağı gir → <strong>Wisersell&apos;de Kapat</strong>.</div>
                  <div>
                    <div className="text-[11px] uppercase text-teal-600 mb-1">Tracking (Wayfair MCF raporundan)</div>
                    <div className="flex items-center gap-2">
                      <input value={trackingDraft} onChange={(e) => setTrackingDraft(e.target.value)} placeholder="örn. 514965862962" className="flex-1 text-sm px-2.5 py-1.5 rounded-lg border border-teal-300 bg-white text-gray-800 font-mono" />
                      <button onClick={() => saveTracking(detailRow.id)} disabled={busy || !trackingDraft.trim()} className="text-sm px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40">Kaydet</button>
                    </div>
                    {detailRow.manualTracking && <div className="mt-1 text-[11px] text-teal-700">Kayıtlı: <span className="font-mono">{detailRow.manualTracking}</span></div>}
                  </div>
                </div>
              )}
              {tab === 'wayfairBekliyor' && (
                <div className="rounded-lg border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm text-fuchsia-800 space-y-2">
                  <div className="font-semibold flex items-center gap-1.5"><Tag className="w-4 h-4" /> Wayfair (dropship)</div>
                  <div className="text-xs">Veeqo etiketi alınmaz. Akış: US deposundan (<strong>{whLabel(detailRow.warehouse)}</strong>) <strong>topla & depodan çıkış yap</strong> → Wayfair&apos;in kendi etiketiyle gönder → tracking&apos;i aşağı gir → <strong>Kapatma Bekliyor&apos;dan Wisersell&apos;de Kapat</strong>.</div>
                  <div>
                    <div className="text-[11px] uppercase text-fuchsia-600 mb-1">Tracking (Wayfair etiketinden)</div>
                    <div className="flex items-center gap-2">
                      <input value={trackingDraft} onChange={(e) => setTrackingDraft(e.target.value)} placeholder="örn. 1Z..." className="flex-1 text-sm px-2.5 py-1.5 rounded-lg border border-fuchsia-300 bg-white text-gray-800 font-mono" />
                      <button onClick={() => saveTracking(detailRow.id)} disabled={busy || !trackingDraft.trim()} className="text-sm px-3 py-1.5 rounded-lg bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-40">Kaydet</button>
                    </div>
                    {detailRow.manualTracking && <div className="mt-1 text-[11px] text-fuchsia-700">Kayıtlı: <span className="font-mono">{detailRow.manualTracking}</span></div>}
                  </div>
                </div>
              )}
              {/* Üst bilgi şeridi */}
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-[11px] text-gray-400 uppercase">Pazar Yeri</div><span title={detailRow.marketplaceCode} className="inline-block mt-0.5 text-xs font-medium px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-100">{detailRow.marketplaceLabel || detailRow.marketplaceCode || '—'}</span></div>
                <div><div className="text-[11px] text-gray-400 uppercase">Depo</div><span className={`inline-block mt-0.5 text-xs font-medium px-2 py-0.5 rounded-md border ${whBadge(detailRow.warehouse)}`}>{whLabel(detailRow.warehouse)}</span></div>
                <div><div className="text-[11px] text-gray-400 uppercase">Tracking</div><div className="mt-0.5 font-mono text-xs text-gray-700">{detailRow.trackingNumber ?? '—'}</div></div>
                <div>
                  <div className="text-[11px] text-gray-400 uppercase">Kargo Bedeli</div>
                  {detailRow.veeqoShipmentId ? (
                    // Veeqo etiketi: bedel book'tan otomatik, salt-okunur
                    <div className="mt-0.5 text-xs text-gray-700">{detailRow.labelCost != null ? `$${detailRow.labelCost.toFixed(2)}${detailRow.labelCostCurrency && detailRow.labelCostCurrency !== 'USD' ? ` ${detailRow.labelCostCurrency}` : ''}` : '—'}{detailRow.labelService ? <span className="text-gray-400"> · {detailRow.labelService.replace(/^Veeqo:\s*/, '')}</span> : null}</div>
                  ) : detailRow.labelId && canApprove ? (
                    // Veeqo-dışı (elle yüklenen) etiket: bedel elle girilir/düzeltilir
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">$</span>
                      <input type="number" min={0} step="0.01" value={costDraft} onChange={(e) => setCostDraft(e.target.value)} placeholder="0.00"
                        className="w-20 text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-800" />
                      <button onClick={() => saveCost(detailRow.id)} disabled={busy || !costDraft.trim()}
                        className="text-[11px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">Kaydet</button>
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs text-gray-700">{detailRow.labelCost != null ? `$${detailRow.labelCost.toFixed(2)}` : '—'}</div>
                  )}
                </div>
              </div>

              {/* Alıcı + Adres — ayrı alanlar, tek tıkla kopyala */}
              <div className="grid gap-2 sm:grid-cols-2">
                <CopyField label="Alıcı" value={detailRow.recipientName ?? (detailRow.addressNote ? detailRow.addressNote.split('\n')[1] : null)} />
                <CopyField label="Adres" value={detailRow.shipAddress ?? detailRow.addressNote} icon={<MapPin className="w-3.5 h-3.5" />} multiline />
              </div>

              {/* Ürünler */}
              <div>
                <div className="text-[11px] text-gray-400 uppercase mb-1">Ürünler</div>
                <ul className="text-sm text-gray-700 space-y-1.5">
                  {(detailRow.items ?? []).map((i, ix) => {
                    const nm = i.name ?? i.product_name ?? i.iwasku;
                    const d = i.dims;
                    const hasSize = d && d.lengthIn != null && d.widthIn != null && d.heightIn != null;
                    return (
                      <li key={ix} className="flex justify-between gap-3 border-b border-gray-50 py-1.5">
                        <div className="min-w-0">
                          <div className="leading-snug">{nm}</div>
                          {i.fnsku && <div className="text-[11px] font-mono text-gray-400 mt-0.5">FNSKU: {i.fnsku}</div>}
                          {d && (hasSize || d.weightLb != null) && (
                            <div className="text-[11px] text-gray-400 mt-0.5 whitespace-nowrap">
                              {hasSize && <span>{d.lengthIn}×{d.widthIn}×{d.heightIn} in</span>}
                              {d.weightLb != null && <span>{hasSize ? ' · ' : ''}{d.weightLb} lb</span>}
                            </div>
                          )}
                        </div>
                        <span className="text-gray-400 shrink-0">×{i.qty ?? i.quantity ?? 0}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Etiket (outbound siparişlerde) — yükle/görüntüle/yazdır */}
              {tab !== 'onayBekliyor' && (detailRow.warehouse === 'NJ' || detailRow.warehouse === 'SHOWROOM') && detailRow.id && (
                <div className="rounded-lg border border-gray-100 p-3">
                  <div className="text-[11px] text-gray-400 uppercase mb-2 flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> Kargo Etiketi</div>
                  <LabelUploader warehouseCode={detailRow.warehouse} orderId={detailRow.id} role="ADMIN" />
                </div>
              )}
            </div>

            {/* Aksiyon footer — duruma göre */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50/50">
              <button onClick={() => { setDetailRow(null); load(); }} className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700">Kapat</button>
              {detailRow.amazonCancelledAt && canApprove && (
                <button onClick={() => dropOne(detailRow.id)} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                  <X className="w-4 h-4" /> Listeden Düş
                </button>
              )}
              {tab === 'onayBekliyor' && canApprove && detailRow.manualSource && detailRow.wisersellOrderId && (
                <select
                  value={manualSrc[detailRow.wisersellOrderId] ?? 'TR'}
                  onChange={(e) => setManualSrc((s) => ({ ...s, [detailRow.wisersellOrderId!]: e.target.value }))}
                  className="text-sm border border-amber-300 bg-amber-50 rounded-lg px-2.5 py-2 text-gray-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  title="Kaynak seç. TR = board'dan düşer, Wisersell'de kalır."
                >
                  <option value="TR">TR (standart — board&apos;dan düşer)</option>
                  {(detailRow.sourceOptions ?? []).map((w) => <option key={w} value={w}>{whLabel(w)}</option>)}
                </select>
              )}
              {tab === 'onayBekliyor' && canApprove && (
                <button onClick={() => approveOne(detailRow.wisersellOrderId)} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                  <CheckCircle2 className="w-4 h-4" /> {detailRow.manualSource && (manualSrc[detailRow.wisersellOrderId!] ?? 'TR') === 'TR' ? 'TR\'ye Düşür' : 'Onayla'}
                </button>
              )}
              {tab === 'etiketBekliyor' && canLabelDelete
                && (detailRow.warehouse === 'NJ' || detailRow.warehouse === 'SHOWROOM')
                && !detailRow.trackingNumber && !detailRow.amazonCancelledAt && (
                <button onClick={() => setVeeqoOrder(detailRow)} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">
                  <Tag className="w-4 h-4" /> Veeqo Etiket Al
                </button>
              )}
              {tab === 'etiketBekliyor' && canLabelDelete && detailRow.wisersellOrderId
                && !detailRow.trackingNumber && !detailRow.amazonCancelledAt && (
                <button onClick={() => reopenOne(detailRow.id)} disabled={busy} title="Veeqo cazip değilse / başka sebeple: Onay Bekliyor'a geri al + Wisersell'de açık yap"
                  className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  <RefreshCw className="w-4 h-4" /> Açık Siparişe Geri Al
                </button>
              )}
              {tab === 'etiketBekliyor' && canLabelDelete && detailRow.source === 'MANUAL'
                && !detailRow.trackingNumber && !detailRow.amazonCancelledAt && (
                <button onClick={() => deleteManualOne(detailRow.id)} disabled={busy} title="Manuel girilen siparişi tamamen sil (geri alınamaz)"
                  className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50">
                  <X className="w-4 h-4" /> Sil
                </button>
              )}
              {tab === 'cikisBekliyor' && !detailRow.amazonCancelledAt && (
                <button onClick={() => setShipOrder(detailRow)} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">
                  <Truck className="w-4 h-4" /> Çıkış Yap (FIFO)
                </button>
              )}
              {tab === 'cikisBekliyor' && canLabelDelete && detailRow.veeqoShipmentId && !detailRow.amazonCancelledAt && (
                <button onClick={() => cancelVeeqoOne(detailRow.id)} disabled={busy} title="Veeqo etiketini iptal et (void+iade) → Etiket Bekliyor'a döner"
                  className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                  <X className="w-4 h-4" /> Etiketi İptal Et (iade)
                </button>
              )}
              {tab === 'kapatmaBekliyor' && canApprove && (
                <button onClick={() => closeOne(detailRow.id)} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                  <Send className="w-4 h-4" /> Wisersell&apos;de Kapat
                </button>
              )}
              {tab === 'cgBekliyor' && canApprove && !detailRow.amazonCancelledAt && (
                <button onClick={() => closeOne(detailRow.id)} disabled={busy || !detailRow.manualTracking} title={detailRow.manualTracking ? '' : 'Önce tracking girin'} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40">
                  <Send className="w-4 h-4" /> Wisersell&apos;de Kapat
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CG MCF export — eşleşmeyen part number kuyruğu (uygulama-içi mapping) */}
      {unmatched && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => setUnmatched(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <div className="font-bold text-gray-900 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-orange-500" /> Eşleşmeyen Wayfair Part Number</div>
              <button onClick={() => setUnmatched(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <p className="text-sm text-gray-600">Aşağıdaki iwasku&apos;ların Wayfair part number eşleşmesi yok — export engellendi. Part number&apos;ı girin; kaydedilince <code className="bg-gray-100 px-1 rounded">wayfair_sku_mapping</code>&apos;e yazılır ve export tekrar denenir.</p>
              {unmatched.map((u) => (
                <div key={u.iwasku} className="rounded-lg border border-gray-100 p-3">
                  <div className="text-sm font-medium text-gray-800">{u.productName ?? '—'}</div>
                  <div className="text-[11px] font-mono text-gray-500 mt-0.5">{u.iwasku} · {u.orderNumbers.length} sipariş</div>
                  <input value={mapDraft[u.iwasku] ?? ''} onChange={(e) => setMapDraft((p) => ({ ...p, [u.iwasku]: e.target.value }))} placeholder="Wayfair Part Number (örn. AHM69GEMSTONE)" className="mt-2 w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-800 font-mono" />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50/50">
              <button onClick={() => setUnmatched(null)} className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700">Vazgeç</button>
              <button onClick={submitMappings} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                <Check className="w-4 h-4" /> Kaydet ve Tekrar Dene
              </button>
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

      {/* Veeqo etiket al (rates → seç → book), detay modalinden tetiklenir */}
      {veeqoOrder?.id && (
        <VeeqoLabelModal
          orderId={veeqoOrder.id}
          orderNumber={veeqoOrder.orderNumber ?? veeqoOrder.orderCode ?? ''}
          onClose={() => setVeeqoOrder(null)}
          onSuccess={(tracking, note) => { setVeeqoOrder(null); setDetailRow(null); setMsg(note ?? `Veeqo etiketi alındı — tracking: ${tracking}`); load(); }}
        />
      )}

      {/* Manuel sipariş girişi (Wisersell'de olmayan siparişler) */}
      {manualOpen && (
        <ManualOrderModal
          onClose={() => setManualOpen(false)}
          onSuccess={() => { setManualOpen(false); setTab('etiketBekliyor'); setMsg('Manuel sipariş oluşturuldu — Etiket Bekliyor.'); load(); }}
        />
      )}

      {/* Serbest kargo fiyat sorgu (siparişe bağlı değil) */}
      {rateOpen && <RateQuoteModal onClose={() => setRateOpen(false)} />}
    </div>
  );
}
