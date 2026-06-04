'use client';

/**
 * Birleşik Sipariş ekranı (top-level "Sipariş" ana tab) — Faz 1: SADECE süper-admin.
 * Wisersell → ManuMaestro otomasyonunun kontrol kulesi: Onay + Kapatma + izleme.
 * Per-warehouse /siparis akışına dokunmaz; operatör etiket/çıkışı orada yapar.
 * region: ülke-genişletilebilir (şimdi US).
 */

import { useCallback, useEffect, useState } from 'react';

type StatusKey = 'onayBekliyor' | 'etiketBekliyor' | 'cikisBekliyor' | 'kapatmaBekliyor' | 'kapandi';

const STATUS_LABELS: Record<StatusKey, string> = {
  onayBekliyor: 'Onay Bekliyor',
  etiketBekliyor: 'Etiket Bekliyor',
  cikisBekliyor: 'Çıkış Bekliyor',
  kapatmaBekliyor: 'Kapatma Bekliyor',
  kapandi: 'Kapandı',
};

const WAREHOUSE_LABEL: Record<string, string> = { SHOWROOM: 'Fairfield', NJ: 'Somerset' };

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

  const rows = board?.data[tab] ?? [];
  const counts = board?.counts ?? {};

  const toggle = (key: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  };
  const toggleAll = () => {
    setSelected((prev) => prev.size === rows.length ? new Set() : new Set(rows.map(rowKey)));
  };

  function rowKey(r: Row): string {
    return tab === 'onayBekliyor' ? String(r.wisersellOrderId) : String(r.id);
  }

  const doApprove = async () => {
    const ids = [...selected].map(Number).filter(Boolean);
    if (!ids.length) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/siparis/approve', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wisersellOrderIds: ids }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Onay hatası');
      setMsg(`${json.approved} onaylandı.`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Hata'); } finally { setBusy(false); }
  };

  const doClose = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/siparis/close', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: ids }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Kapatma hatası');
      const failed = (json.results || []).filter((r: { ok: boolean }) => !r.ok);
      setMsg(`${json.closed} kapatıldı.${failed.length ? ` ${failed.length} başarısız: ${failed.map((f: { message: string }) => f.message).join('; ')}` : ''}`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Hata'); } finally { setBusy(false); }
  };

  const doAutoRun = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/siparis/auto-run?region=${region}`, { method: 'POST', credentials: 'include' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Auto-run hatası');
      setMsg(`Otomatik: ${json.approved} onaylandı.`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Hata'); } finally { setBusy(false); }
  };

  const itemsText = (items?: ItemLite[]) =>
    (items ?? []).map((i) => `${i.name ?? i.product_name ?? i.iwasku ?? '?'} ×${i.qty ?? i.quantity ?? 0}`).join(', ');

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sipariş</h1>
          <p className="text-xs text-gray-500">Wisersell → US depo otomasyonu (süper-admin) · region {region}</p>
        </div>
        <div className="flex items-center gap-2">
          {counts.bekleyenStokYok ? (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Stok/iwasku eksik: {counts.bekleyenStokYok} (gösterilmiyor)
            </span>
          ) : null}
          <button onClick={load} disabled={busy} className="text-sm px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200">Yenile</button>
          <button onClick={doAutoRun} disabled={busy} className="text-sm px-3 py-1.5 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200" title="WISERSELL_AUTO_APPROVE açıksa tüm uygun adayları onaylar">Tümünü Onayla (oto)</button>
        </div>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(STATUS_LABELS) as StatusKey[]).map((k) => (
          <button
            key={k}
            onClick={() => { setTab(k); setSelected(new Set()); }}
            className={`text-sm px-3 py-1.5 rounded-full border ${tab === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
          >
            {STATUS_LABELS[k]} <span className="opacity-70">({counts[k] ?? 0})</span>
          </button>
        ))}
      </div>

      {msg && <div className="mb-3 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded px-3 py-2 whitespace-pre-wrap">{msg}</div>}
      {error && <div className="mb-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      {/* Bulk actions */}
      {tab === 'onayBekliyor' && rows.length > 0 && (
        <div className="mb-2">
          <button onClick={doApprove} disabled={busy || selected.size === 0} className="text-sm px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            Onayla ({selected.size})
          </button>
        </div>
      )}
      {tab === 'kapatmaBekliyor' && rows.length > 0 && (
        <div className="mb-2">
          <button onClick={doClose} disabled={busy || selected.size === 0} className="text-sm px-4 py-2 rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
            Wisersell&apos;de Kapat ({selected.size})
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500 py-8 text-center">Yükleniyor…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500 py-8 text-center">Kayıt yok.</div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                {(tab === 'onayBekliyor' || tab === 'kapatmaBekliyor') && (
                  <th className="px-3 py-2 w-8"><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} /></th>
                )}
                <th className="px-3 py-2">Sipariş No</th>
                <th className="px-3 py-2">Pazar Yeri</th>
                <th className="px-3 py-2">Alıcı / Adres</th>
                <th className="px-3 py-2">Depo</th>
                <th className="px-3 py-2">Ürünler</th>
                {tab !== 'onayBekliyor' && <th className="px-3 py-2">Tracking</th>}
                {tab === 'onayBekliyor' && <th className="px-3 py-2">Label</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const key = rowKey(r);
                return (
                  <tr key={key} className="hover:bg-gray-50">
                    {(tab === 'onayBekliyor' || tab === 'kapatmaBekliyor') && (
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} /></td>
                    )}
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {r.orderCode ?? r.orderNumber}
                      {r.readyPending && <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1">ready-pending</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.marketplaceCode ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-pre-line max-w-xs">
                      {[r.recipientName, r.shipAddress].filter(Boolean).join('\n') || r.addressNote || '—'}
                    </td>
                    <td className="px-3 py-2">{WAREHOUSE_LABEL[r.warehouse ?? ''] ?? r.warehouse ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-md truncate" title={itemsText(r.items)}>{itemsText(r.items)}</td>
                    {tab !== 'onayBekliyor' && <td className="px-3 py-2 text-gray-600">{r.trackingNumber ?? '—'}</td>}
                    {tab === 'onayBekliyor' && <td className="px-3 py-2 text-gray-500">{r.labelNo ?? '—'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
