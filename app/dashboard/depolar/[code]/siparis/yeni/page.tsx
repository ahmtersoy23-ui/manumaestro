/**
 * Yeni Sipariş Yarat — DRAFT yaratma formu.
 * Type query'den okunur: ?type=SINGLE | FBA_PICKUP
 * SINGLE akışı: marketplace prefill (?marketplace=...) + sipariş no + ürün satırları + adres notu
 *   → tek POST, order + items birlikte yaratılır → /siparis listesine döner.
 * FBA_PICKUP akışı: eski yapı (önce yarat → detayda kolileri ekle).
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, AlertCircle, Box as BoxIcon, Plus, Trash2 } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { slugToCode, codeToSlug, warehouseLabel } from '@/lib/warehouseLabels';
import { ProductSearch, type ProductHit as PSProductHit } from '@/components/wms/ProductSearch';

const logger = createLogger('YeniSiparis');

interface UsAvail {
  NJ: number;
  SHOWROOM: number;
}

type RowStatus =
  | { kind: 'neutral'; text: string }
  | { kind: 'loading' }
  | { kind: 'ok'; text: string }
  | { kind: 'warn'; text: string }
  | { kind: 'block'; text: string; targetCode?: 'NJ' | 'SHOWROOM' };

/**
 * Bir ürün satırının US depo stok durumu — Fairfield (SHOWROOM) önceliği.
 * Backend lib/wms/usWarehouseStock.ts kuralının frontend aynası (canlı ikaz/blok).
 * Asıl zorlama backend create endpoint'inde; bu sadece operatöre önden bilgi.
 */
function rowStatus(
  code: string,
  iwasku: string,
  qty: number,
  avail: UsAvail | null
): RowStatus {
  if (!iwasku || (code !== 'NJ' && code !== 'SHOWROOM')) return { kind: 'neutral', text: '' };
  if (avail === null) return { kind: 'loading' };
  const f = avail.SHOWROOM; // Fairfield — öncelik
  const s = avail.NJ; // Somerset
  if (!qty || qty <= 0) {
    return { kind: 'neutral', text: `Fairfield ${f} · Somerset ${s}` };
  }
  if (f <= 0 && s <= 0) return { kind: 'block', text: 'Hiçbir US deposunda stok yok' };

  let correct: 'NJ' | 'SHOWROOM';
  let sufficient: boolean;
  if (f >= qty) {
    correct = 'SHOWROOM';
    sufficient = true;
  } else if (s >= qty) {
    correct = 'NJ';
    sufficient = true;
  } else {
    correct = f >= s ? 'SHOWROOM' : 'NJ';
    sufficient = false;
  }

  if (correct !== code) {
    return correct === 'SHOWROOM'
      ? { kind: 'block', text: `Öncelik Fairfield — Fairfield'da ${f} adet var, Fairfield deposundan girin`, targetCode: 'SHOWROOM' }
      : { kind: 'block', text: `Fairfield'da yeterli stok yok (${f}); Somerset'te ${s} adet var — Somerset deposundan girin`, targetCode: 'NJ' };
  }
  const here = code === 'SHOWROOM' ? f : s;
  const label = warehouseLabel(code);
  return sufficient
    ? { kind: 'ok', text: `${label}'da ${here} adet kullanılabilir` }
    : { kind: 'warn', text: `${label}'da yeterli stok yok (${here}/${qty}) — yine de en çok burada` };
}

interface Marketplace {
  code: string;
  name: string;
  marketplaceType?: string;
}

type ProductHit = PSProductHit;

interface ItemRow {
  id: string; // local row id
  iwasku: string;
  display: string; // "iwasku — name"
  quantity: number | '';
}

const newRow = (): ItemRow => ({
  id: Math.random().toString(36).slice(2),
  iwasku: '',
  display: '',
  quantity: '',
});

export default function YeniSiparisPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = use(params);
  const code = slugToCode(rawCode) ?? rawCode.toUpperCase();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderType = (searchParams.get('type') === 'FBA_PICKUP' ? 'FBA_PICKUP' : 'SINGLE') as
    | 'SINGLE'
    | 'FBA_PICKUP';
  const prefilledMarketplace = searchParams.get('marketplace') ?? '';
  const returnTo = searchParams.get('returnTo') ?? '';
  const editId = searchParams.get('edit'); // dolu ise düzenleme modu (DRAFT SINGLE)

  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [marketplaceCode, setMarketplaceCode] = useState(prefilledMarketplace);
  const [orderNumber, setOrderNumber] = useState('');
  const [description, setDescription] = useState('');
  const [addressNote, setAddressNote] = useState('');
  const [items, setItems] = useState<ItemRow[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // iwasku → US depo kullanılabilir stok (stok-check), satır rozeti için cache.
  const [availByIwasku, setAvailByIwasku] = useState<Record<string, UsAvail>>({});

  // SINGLE'da en az 1 ürün satırı eksiksiz olmalı (iwasku + qty>0).
  const hasValidItems =
    orderType !== 'SINGLE' ||
    items.some(
      (r) => r.iwasku.trim().length > 0 && typeof r.quantity === 'number' && r.quantity > 0
    );

  // Seçili ürünlerin US stoğunu çek (yalnız NJ/SHOWROOM; her iwasku bir kez).
  useEffect(() => {
    if (orderType !== 'SINGLE' || (code !== 'NJ' && code !== 'SHOWROOM')) return;
    const needed = [...new Set(items.map((r) => r.iwasku).filter(Boolean))].filter(
      (iw) => !(iw in availByIwasku)
    );
    if (needed.length === 0) return;
    let cancelled = false;
    Promise.all(
      needed.map((iw) =>
        fetch(
          `/api/depolar/${code}/siparis/stock-check?iwasku=${encodeURIComponent(iw)}${editId ? `&excludeOrderId=${encodeURIComponent(editId)}` : ''}`,
          { credentials: 'include' }
        )
          .then((r) => r.json())
          .then((d) => (d.success ? ([iw, { NJ: d.data.NJ, SHOWROOM: d.data.SHOWROOM }] as const) : null))
          .catch((e) => {
            logger.error('stock-check', e);
            return null;
          })
      )
    ).then((pairs) => {
      if (cancelled) return;
      const add: Record<string, UsAvail> = {};
      for (const p of pairs) if (p) add[p[0]] = p[1];
      if (Object.keys(add).length) setAvailByIwasku((prev) => ({ ...prev, ...add }));
    });
    return () => {
      cancelled = true;
    };
  }, [items, code, orderType, availByIwasku, editId]);

  // Edit modu: mevcut DRAFT siparişi yükle, formu doldur.
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    fetch(`/api/depolar/${code}/siparis/${editId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.success) return;
        const o = d.data.order;
        setMarketplaceCode(o.marketplaceCode);
        setOrderNumber(o.orderNumber);
        setAddressNote(o.addressNote ?? '');
        setDescription(o.description ?? '');
        const rows: ItemRow[] = (d.data.items ?? []).map(
          (it: { iwasku: string; productName: string | null; quantity: number }) => ({
            id: Math.random().toString(36).slice(2),
            iwasku: it.iwasku,
            display: `${it.iwasku}${it.productName ? ` — ${it.productName}` : ''}`,
            quantity: it.quantity,
          })
        );
        if (rows.length > 0) setItems(rows);
      })
      .catch((e) => logger.error('Edit yükleme', e));
    return () => {
      cancelled = true;
    };
  }, [editId, code]);

  // Yanlış depo / hiç stok olmayan satır varsa sipariş yaratma engellenir.
  const anyBlocked =
    orderType === 'SINGLE' &&
    items.some((r) => {
      if (!r.iwasku.trim()) return false;
      const q = typeof r.quantity === 'number' ? r.quantity : 0;
      return rowStatus(code, r.iwasku, q, availByIwasku[r.iwasku] ?? null).kind === 'block';
    });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/marketplaces?limit=200', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          let list = (d.data || []) as Marketplace[];
          if (orderType === 'FBA_PICKUP') {
            list = list.filter((m) => m.code.startsWith('AMZN_') || m.marketplaceType === 'AMAZON');
          }
          setMarketplaces(list);
        }
      })
      .catch((e) => logger.error('Marketplaces fetch', e));
    return () => {
      cancelled = true;
    };
  }, [orderType]);

  const addRow = () => setItems((prev) => [...prev, newRow()]);
  const removeRow = (id: string) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));
  const updateRow = (id: string, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function handleSubmit() {
    setError(null);
    if (!marketplaceCode) return setError('Marketplace seçin');
    if (!orderNumber.trim())
      return setError(orderType === 'FBA_PICKUP' ? 'Pickup ID girin' : 'Sipariş no girin');

    let itemsPayload: { iwasku: string; quantity: number }[] | undefined;
    if (orderType === 'SINGLE') {
      // Boş satırları at, kalanların hepsi geçerli mi kontrol et
      const cleaned = items
        .map((r) => ({ iwasku: r.iwasku.trim(), quantity: typeof r.quantity === 'number' ? r.quantity : 0 }))
        .filter((r) => r.iwasku || r.quantity);
      if (cleaned.length === 0) return setError('En az 1 ürün satırı girin');
      for (const r of cleaned) {
        if (!r.iwasku) return setError('Tüm satırlarda ürün seçin');
        if (!r.quantity || r.quantity <= 0) return setError('Tüm satırlarda adet girin');
      }
      itemsPayload = cleaned;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        editId ? `/api/depolar/${code}/siparis/${editId}` : `/api/depolar/${code}/siparis`,
        {
          method: editId ? 'PUT' : 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderType,
            marketplaceCode,
            orderNumber: orderNumber.trim(),
            description: description.trim() || undefined,
            addressNote: addressNote.trim() || undefined,
            items: itemsPayload,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || (editId ? 'Sipariş güncellenemedi' : 'Sipariş yaratılamadı'));
        return;
      }
      // Edit modu: sipariş detayına dön
      if (editId) {
        router.push(`/dashboard/depolar/${codeToSlug(code)}/siparis/${editId}`);
      } else if (orderType === 'FBA_PICKUP') {
        router.push(`/dashboard/depolar/${codeToSlug(code)}/siparis/${data.data.id}`);
      } else if (returnTo === 'marketplace' && marketplaceCode) {
        router.push(
          `/dashboard/depolar/${codeToSlug(code)}/siparis/marketplace/${marketplaceCode}?stage=kargo`
        );
      } else {
        router.push(`/dashboard/depolar/${codeToSlug(code)}/siparis`);
      }
    } catch (e) {
      logger.error('Submit hatası', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link
        href={`/dashboard/depolar/${codeToSlug(code)}/siparis`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <ChevronLeft className="w-4 h-4" /> Sipariş Çıkış
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          {editId ? (
            'Sipariş Düzenle'
          ) : orderType === 'FBA_PICKUP' ? (
            <>
              <BoxIcon className="w-5 h-5 text-orange-500" /> Yeni FBA Pick-up
            </>
          ) : (
            'Yeni Tekil Sipariş'
          )}
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          {orderType === 'FBA_PICKUP'
            ? 'Amazon FBA için koli bazlı pick-up. Önce sipariş yarat, sonra kolileri listeden ekle.'
            : 'Sipariş no + ürün/miktar + adres notu. Yaratıldıktan sonra "Kargo etiketi bekleyen" kovasına düşer.'}
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {orderType === 'FBA_PICKUP' ? 'Pazaryeri (Amazon)' : 'Pazaryeri'}
            </label>
            {prefilledMarketplace && returnTo === 'marketplace' ? (
              // Pazaryeri sayfasından geldi — değiştirilemez, salt-okunur rozet
              <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-sm">
                <span className="font-medium text-gray-900">
                  {marketplaces.find((m) => m.code === marketplaceCode)?.name ?? marketplaceCode}
                </span>
                <span className="font-mono text-xs text-gray-500">{marketplaceCode}</span>
              </div>
            ) : (
              <select
                value={marketplaceCode}
                onChange={(e) => setMarketplaceCode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
              >
                <option value="">Seçin…</option>
                {marketplaces.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code} — {m.name}
                  </option>
                ))}
              </select>
            )}
            {orderType === 'FBA_PICKUP' && marketplaces.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">Amazon pazaryeri bulunamadı.</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {orderType === 'FBA_PICKUP' ? 'Pickup / Appointment ID' : 'Sipariş No'}
            </label>
            <input
              type="text"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder={
                orderType === 'FBA_PICKUP'
                  ? 'örn. APPT-2026-04-26-001'
                  : 'örn. 902-1234567-8901234'
              }
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:border-blue-400"
              autoComplete="off"
            />
          </div>
        </div>

        {/* SINGLE ürün satırları */}
        {orderType === 'SINGLE' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-gray-700">Ürünler *</label>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
              >
                <Plus className="w-3 h-3" /> Satır Ekle
              </button>
            </div>
            <div className="space-y-2">
              {items.map((row) => (
                <ItemRowInput
                  key={row.id}
                  row={row}
                  canRemove={items.length > 1}
                  marketplaceCode={marketplaceCode}
                  status={rowStatus(
                    code,
                    row.iwasku,
                    typeof row.quantity === 'number' ? row.quantity : 0,
                    availByIwasku[row.iwasku] ?? null
                  )}
                  onChange={(patch) => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* SINGLE adres notu */}
        {orderType === 'SINGLE' && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Adres / Açıklama
            </label>
            <textarea
              value={addressNote}
              onChange={(e) => setAddressNote(e.target.value)}
              rows={3}
              placeholder="Müşteri adresi, kargo notu, vb."
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
        )}

        {/* FBA için kısa açıklama */}
        {orderType === 'FBA_PICKUP' && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Açıklama (opsiyonel)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-3 h-3" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Link
            href={
              returnTo === 'marketplace' && marketplaceCode
                ? `/dashboard/depolar/${codeToSlug(code)}/siparis/marketplace/${marketplaceCode}`
                : `/dashboard/depolar/${codeToSlug(code)}/siparis`
            }
            className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            İptal
          </Link>
          <button
            onClick={handleSubmit}
            disabled={submitting || !marketplaceCode || !orderNumber.trim() || !hasValidItems || anyBlocked}
            title={
              anyBlocked
                ? 'Bir veya daha fazla satır yanlış depo / stok yok — düzeltin'
                : !hasValidItems && orderType === 'SINGLE'
                  ? 'En az 1 ürün ve adet girilmeli'
                  : undefined
            }
            className={`px-3 py-1.5 text-sm text-white rounded-md disabled:opacity-50 ${
              orderType === 'FBA_PICKUP'
                ? 'bg-orange-500 hover:bg-orange-600'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {submitting
              ? editId
                ? 'Kaydediliyor…'
                : 'Yaratılıyor…'
              : editId
                ? 'Kaydet'
                : orderType === 'FBA_PICKUP'
                  ? 'Sipariş Yarat (DRAFT)'
                  : 'Sipariş Yarat'}
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
  marketplaceCode: string;
  onChange: (patch: Partial<ItemRow>) => void;
  onRemove: () => void;
}

const STATUS_STYLES: Record<'ok' | 'warn' | 'block' | 'neutral', string> = {
  ok: 'text-green-700',
  warn: 'text-amber-700',
  block: 'text-red-700',
  neutral: 'text-gray-400',
};

function ItemRowInput({ row, canRemove, status, marketplaceCode, onChange, onRemove }: ItemRowInputProps) {
  // ProductSearch interface ile uyumlu adapter:
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
        <input
          type="number"
          min="1"
          value={row.quantity}
          onChange={(e) => onChange({ quantity: e.target.value === '' ? '' : Number(e.target.value) })}
          placeholder="Adet"
          className="w-24 px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400 text-gray-900"
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          title={canRemove ? 'Satırı sil' : ''}
          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
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
                  <Link
                    href={`/dashboard/depolar/${codeToSlug(status.targetCode)}/siparis/yeni?type=SINGLE${
                      marketplaceCode ? `&marketplace=${encodeURIComponent(marketplaceCode)}` : ''
                    }`}
                    className="ml-1 text-blue-600 underline hover:text-blue-800"
                  >
                    → {warehouseLabel(status.targetCode)} sipariş sayfası
                  </Link>
                )}
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
}
