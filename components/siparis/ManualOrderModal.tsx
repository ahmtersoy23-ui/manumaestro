/**
 * Manuel Sipariş Girişi modalı — Sipariş board'ından elle sipariş oluşturur.
 * Eski depolar "Yeni Tekil Sipariş" (/yeni) formunun SINGLE versiyonunun board içi
 * uyarlaması: depo seçici (Fairfield/Somerset) + marketplace + sipariş no + ürün
 * satırları (Fairfield-öncelikli canlı stok ikazı) + adres. POST /api/siparis/manual.
 */

'use client';

import { useEffect, useState } from 'react';
import { X, Plus, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { warehouseLabel } from '@/lib/warehouseLabels';
import { ProductSearch, type ProductHit } from '@/components/wms/ProductSearch';

const logger = createLogger('ManualOrderModal');

type WhCode = 'SHOWROOM' | 'NJ';
const WH_OPTIONS: { code: WhCode; label: string }[] = [
  { code: 'SHOWROOM', label: 'Fairfield' },
  { code: 'NJ', label: 'Somerset' },
];

interface UsAvail { NJ: number; SHOWROOM: number; fnsku?: string | null; }

type RowStatus =
  | { kind: 'neutral'; text: string }
  | { kind: 'loading' }
  | { kind: 'ok'; text: string }
  | { kind: 'warn'; text: string }
  | { kind: 'block'; text: string; targetCode?: WhCode };

/** Satır stok durumu — Fairfield (SHOWROOM) önceliği. Backend kuralının (lib/wms/usWarehouseStock) frontend aynası. */
function rowStatus(code: string, iwasku: string, qty: number, avail: UsAvail | null): RowStatus {
  if (!iwasku || (code !== 'NJ' && code !== 'SHOWROOM')) return { kind: 'neutral', text: '' };
  if (avail === null) return { kind: 'loading' };
  const f = avail.SHOWROOM;
  const s = avail.NJ;
  if (!qty || qty <= 0) return { kind: 'neutral', text: `Fairfield ${f} · Somerset ${s}` };
  if (f <= 0 && s <= 0) return { kind: 'block', text: 'Hiçbir US deposunda stok yok' };

  let correct: WhCode;
  let sufficient: boolean;
  if (f >= qty) { correct = 'SHOWROOM'; sufficient = true; }
  else if (s >= qty) { correct = 'NJ'; sufficient = true; }
  else { correct = f >= s ? 'SHOWROOM' : 'NJ'; sufficient = false; }

  if (correct !== code) {
    return correct === 'SHOWROOM'
      ? { kind: 'block', text: `Öncelik Fairfield — Fairfield'da ${f} adet var`, targetCode: 'SHOWROOM' }
      : { kind: 'block', text: `Fairfield'da yeterli stok yok (${f}); Somerset'te ${s} adet var`, targetCode: 'NJ' };
  }
  const here = code === 'SHOWROOM' ? f : s;
  const label = warehouseLabel(code);
  return sufficient
    ? { kind: 'ok', text: `${label}'da ${here} adet kullanılabilir` }
    : { kind: 'warn', text: `${label}'da yeterli stok yok (${here}/${qty}) — yine de en çok burada` };
}

interface Marketplace { code: string; name: string; region?: string | null; }
interface ItemRow { id: string; iwasku: string; display: string; quantity: number | ''; }
const newRow = (): ItemRow => ({ id: Math.random().toString(36).slice(2), iwasku: '', display: '', quantity: '' });

const STATUS_STYLES: Record<'ok' | 'warn' | 'block' | 'neutral', string> = {
  ok: 'text-green-700', warn: 'text-amber-700', block: 'text-red-700', neutral: 'text-gray-400',
};

export function ManualOrderModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [warehouseCode, setWarehouseCode] = useState<WhCode | ''>('');
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [marketplaceCode, setMarketplaceCode] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [addressNote, setAddressNote] = useState('');
  const [items, setItems] = useState<ItemRow[]>([newRow()]);
  const [availByIwasku, setAvailByIwasku] = useState<Record<string, UsAvail>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Marketplace listesi
  useEffect(() => {
    let cancelled = false;
    fetch('/api/marketplaces?limit=200', { credentials: 'include' })
      .then((r) => r.json())
      // Sipariş board şimdilik US → pazar yerini US'lere daralt (gerekirse sonra kaldırılır).
      .then((d) => { if (!cancelled && d.success) setMarketplaces(((d.data || []) as Marketplace[]).filter((m) => m.region === 'US')); })
      .catch((e) => logger.error('Marketplaces fetch', e));
    return () => { cancelled = true; };
  }, []);

  // Seçili ürünlerin US stoğu (stock-check her iwasku'da hem NJ hem SHOWROOM döner → depo değişince refetch gerekmez)
  useEffect(() => {
    if (!warehouseCode) return;
    const needed = [...new Set(items.map((r) => r.iwasku).filter(Boolean))].filter((iw) => !(iw in availByIwasku));
    if (needed.length === 0) return;
    let cancelled = false;
    Promise.all(
      needed.map((iw) =>
        fetch(`/api/depolar/${warehouseCode}/siparis/stock-check?iwasku=${encodeURIComponent(iw)}`, { credentials: 'include' })
          .then((r) => r.json())
          .then((d) => (d.success ? ([iw, { NJ: d.data.NJ, SHOWROOM: d.data.SHOWROOM, fnsku: d.data.fnsku ?? null }] as const) : null))
          .catch((e) => { logger.error('stock-check', e); return null; }),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const add: Record<string, UsAvail> = {};
      for (const p of pairs) if (p) add[p[0]] = p[1];
      if (Object.keys(add).length) setAvailByIwasku((prev) => ({ ...prev, ...add }));
    });
    return () => { cancelled = true; };
  }, [items, warehouseCode, availByIwasku]);

  const addRow = () => setItems((prev) => [...prev, newRow()]);
  const removeRow = (id: string) => setItems((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));
  const updateRow = (id: string, patch: Partial<ItemRow>) => setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const hasValidItems = items.some((r) => r.iwasku.trim() && typeof r.quantity === 'number' && r.quantity > 0);
  const anyBlocked = items.some((r) => {
    if (!r.iwasku.trim()) return false;
    const q = typeof r.quantity === 'number' ? r.quantity : 0;
    return rowStatus(warehouseCode, r.iwasku, q, availByIwasku[r.iwasku] ?? null).kind === 'block';
  });

  async function handleSubmit() {
    setError(null);
    if (!warehouseCode) return setError('Depo seçin');
    if (!marketplaceCode) return setError('Pazaryeri seçin');
    if (!orderNumber.trim()) return setError('Sipariş no girin');

    const cleaned = items
      .map((r) => ({ iwasku: r.iwasku.trim(), quantity: typeof r.quantity === 'number' ? r.quantity : 0 }))
      .filter((r) => r.iwasku || r.quantity);
    if (cleaned.length === 0) return setError('En az 1 ürün satırı girin');
    for (const r of cleaned) {
      if (!r.iwasku) return setError('Tüm satırlarda ürün seçin');
      if (!r.quantity || r.quantity <= 0) return setError('Tüm satırlarda adet girin');
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/siparis/manual', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseCode,
          marketplaceCode,
          orderNumber: orderNumber.trim(),
          addressNote: addressNote.trim() || undefined,
          items: cleaned,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error || 'Sipariş yaratılamadı'); return; }
      onSuccess();
    } catch (e) {
      logger.error('Submit', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
          <div>
            <div className="font-bold text-gray-900">Manuel Sipariş Girişi</div>
            <div className="text-xs text-gray-500">Wisersell&apos;de olmayan sipariş — depodan çıkışta kapanır</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 max-h-[72vh] overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Depo *</label>
              <select value={warehouseCode} onChange={(e) => setWarehouseCode(e.target.value as WhCode)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400">
                <option value="">Seçin…</option>
                {WH_OPTIONS.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Pazaryeri *</label>
              <select value={marketplaceCode} onChange={(e) => setMarketplaceCode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400">
                <option value="">Seçin…</option>
                {marketplaces.map((m) => <option key={m.code} value={m.code}>{m.name} · {m.code}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sipariş No *</label>
              <input type="text" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="örn. 114-1234567-8901234" autoComplete="off"
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:border-blue-400" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-gray-700">Ürünler *</label>
              <button type="button" onClick={addRow}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 rounded">
                <Plus className="w-3 h-3" /> Satır Ekle
              </button>
            </div>
            <div className="space-y-2">
              {items.map((row) => (
                <ItemRowInput
                  key={row.id}
                  row={row}
                  canRemove={items.length > 1}
                  status={rowStatus(warehouseCode, row.iwasku, typeof row.quantity === 'number' ? row.quantity : 0, availByIwasku[row.iwasku] ?? null)}
                  fnsku={availByIwasku[row.iwasku]?.fnsku ?? null}
                  onSwitchWarehouse={(c) => setWarehouseCode(c)}
                  onChange={(patch) => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Adres / Açıklama</label>
            <textarea value={addressNote} onChange={(e) => setAddressNote(e.target.value)} rows={3}
              placeholder="Müşteri adı + adresi, kargo notu, vb."
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400" />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-start gap-2 whitespace-pre-line">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50/50">
          <button onClick={onClose} className="px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg">İptal</button>
          <button onClick={handleSubmit}
            disabled={submitting || !warehouseCode || !marketplaceCode || !orderNumber.trim() || !hasValidItems || anyBlocked}
            title={anyBlocked ? 'Bir veya daha fazla satır yanlış depo / stok yok — düzeltin' : undefined}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}{submitting ? 'Yaratılıyor…' : 'Sipariş Yarat'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ItemRowInputProps {
  row: ItemRow;
  canRemove: boolean;
  status: RowStatus;
  fnsku: string | null;
  onSwitchWarehouse: (code: WhCode) => void;
  onChange: (patch: Partial<ItemRow>) => void;
  onRemove: () => void;
}

function ItemRowInput({ row, canRemove, status, fnsku, onSwitchWarehouse, onChange, onRemove }: ItemRowInputProps) {
  const selected: ProductHit | null = row.iwasku
    ? { iwasku: row.iwasku, name: row.display.split(' — ')[1] ?? '', category: null }
    : null;

  return (
    <div>
      <div className="flex gap-2 items-start">
        <div className="flex-1">
          <ProductSearch
            selected={selected}
            onSelect={(p) => onChange({ iwasku: p.iwasku, display: `${p.iwasku} — ${p.name}` })}
            onClear={() => onChange({ iwasku: '', display: '' })}
            compact
          />
        </div>
        <input type="number" min="1" value={row.quantity}
          onChange={(e) => onChange({ quantity: e.target.value === '' ? '' : Number(e.target.value) })}
          placeholder="Adet"
          className="w-24 px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400 text-gray-900" />
        <button type="button" onClick={onRemove} disabled={!canRemove} title={canRemove ? 'Satırı sil' : ''}
          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md disabled:opacity-40 disabled:cursor-not-allowed">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {row.iwasku && fnsku && (
        <div className="mt-1 ml-1 text-[11px] font-mono text-gray-400">FNSKU: {fnsku}</div>
      )}
      {row.iwasku && (
        <div className="mt-1 ml-1 text-[11px] flex items-center gap-1">
          {status.kind === 'loading' ? (
            <span className="text-gray-400">Stok kontrol ediliyor…</span>
          ) : (
            status.text && (
              <span className={`flex items-center gap-1 flex-wrap ${STATUS_STYLES[status.kind]}`}>
                {status.kind === 'block' && <AlertCircle className="w-3 h-3" />}
                {status.text}
                {status.kind === 'block' && status.targetCode && (
                  <button type="button" onClick={() => onSwitchWarehouse(status.targetCode!)}
                    className="ml-1 text-blue-600 underline hover:text-blue-800">
                    → {warehouseLabel(status.targetCode)} deposuna geç
                  </button>
                )}
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
}
