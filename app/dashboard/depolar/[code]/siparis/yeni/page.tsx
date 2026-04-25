/**
 * Yeni Sipariş Yarat — DRAFT yaratma formu.
 * Type query string'den okunur: ?type=SINGLE veya ?type=FBA_PICKUP
 * Yaratıldıktan sonra sipariş detay sayfasına redirect.
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, AlertCircle, Box as BoxIcon } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('YeniSiparis');

interface Marketplace {
  code: string;
  name: string;
  marketplaceType?: string;
}

export default function YeniSiparisPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderType = (searchParams.get('type') === 'FBA_PICKUP' ? 'FBA_PICKUP' : 'SINGLE') as
    | 'SINGLE'
    | 'FBA_PICKUP';

  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [marketplaceCode, setMarketplaceCode] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/marketplaces?limit=200', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          let list = (d.data || []) as Marketplace[];
          // FBA_PICKUP için sadece Amazon marketplaces
          if (orderType === 'FBA_PICKUP') {
            list = list.filter((m) => m.code.startsWith('AMZN_') || m.marketplaceType === 'AMAZON');
          }
          setMarketplaces(list);
        }
      })
      .catch((e) => logger.error('Marketplaces fetch', e));
    return () => { cancelled = true; };
  }, [orderType]);

  async function handleSubmit() {
    setError(null);
    if (!marketplaceCode) return setError('Marketplace seçin');
    if (!orderNumber.trim()) return setError(orderType === 'FBA_PICKUP' ? 'Pickup ID girin' : 'Sipariş no girin');

    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${code}/siparis`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderType,
          marketplaceCode,
          orderNumber: orderNumber.trim(),
          description: description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Sipariş yaratılamadı');
        return;
      }
      router.push(`/dashboard/depolar/${code}/siparis/${data.data.id}`);
    } catch (e) {
      logger.error('Submit hatası', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <Link
        href={`/dashboard/depolar/${code}/siparis`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <ChevronLeft className="w-4 h-4" /> Sipariş Çıkış
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          {orderType === 'FBA_PICKUP' ? (
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
            : 'Marketplace bazlı tekil sipariş. Önce sipariş yarat, sonra raf/koli'+ "'"+'den kalemleri ekle.'}
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            {orderType === 'FBA_PICKUP' ? 'Pazaryeri (Amazon)' : 'Pazaryeri'}
          </label>
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
            placeholder={orderType === 'FBA_PICKUP' ? 'örn. APPT-2026-04-26-001' : 'örn. 902-1234567-8901234'}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:border-blue-400"
            autoComplete="off"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Açıklama (opsiyonel)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-3 h-3" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Link
            href={`/dashboard/depolar/${code}/siparis`}
            className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            İptal
          </Link>
          <button
            onClick={handleSubmit}
            disabled={submitting || !marketplaceCode || !orderNumber.trim()}
            className={`px-3 py-1.5 text-sm text-white rounded-md disabled:opacity-50 ${
              orderType === 'FBA_PICKUP' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {submitting ? 'Yaratılıyor…' : 'Sipariş Yarat (DRAFT)'}
          </button>
        </div>
      </div>
    </div>
  );
}
