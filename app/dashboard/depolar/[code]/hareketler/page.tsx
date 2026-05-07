/**
 * Hareket Geçmişi — filterable audit log.
 * Tip / iwasku / tarih aralığı / raf / kullanıcı filtreleri + pagination.
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ChevronLeft, History, AlertCircle, Search, X as XIcon } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { warehouseLabel, slugToCode, codeToSlug } from '@/lib/warehouseLabels';

const logger = createLogger('HareketGecmisi');

interface MovementRow {
  id: string;
  type: string;
  iwasku: string | null;
  quantity: number | null;
  fromShelfCode: string | null;
  toShelfCode: string | null;
  refType: string | null;
  refId: string | null;
  userId: string;
  userName: string | null;
  notes: string | null;
  createdAt: string;
  reverseOfId: string | null;
  reversedByCount: number;
}

const TYPE_LABEL: Record<string, string> = {
  INBOUND_FROM_SHIPMENT: 'Sevkiyat Girişi',
  INBOUND_MANUAL: 'Manuel Giriş',
  TRANSFER: 'Transfer',
  CROSS_WAREHOUSE_TRANSFER: 'Cross-Warehouse',
  BOX_OPEN: 'Koli Açıldı',
  OUTBOUND: 'Çıkış',
  ADJUSTMENT: 'Düzeltme',
  REVERSAL: 'Geri Alma',
};

const TYPE_OPTIONS = [
  '',
  'INBOUND_FROM_SHIPMENT',
  'INBOUND_MANUAL',
  'TRANSFER',
  'CROSS_WAREHOUSE_TRANSFER',
  'BOX_OPEN',
  'OUTBOUND',
  'ADJUSTMENT',
  'REVERSAL',
];

export default function HareketGecmisiPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = use(params);
  const code = slugToCode(rawCode) ?? rawCode.toUpperCase();

  const [rows, setRows] = useState<MovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState('');
  const [iwasku, setIwasku] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 100;

  useEffect(() => {
    let cancelled = false;
    // setState'leri timeout'a taşı (React 19 cascade-render guard)
    const t = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (iwasku.trim()) params.set('iwasku', iwasku.trim());
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to + 'T23:59:59').toISOString());
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      fetch(`/api/depolar/${code}/hareketler?${params}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.success) {
            setRows(d.data.rows);
            setTotal(d.data.total);
            setHasMore(d.data.hasMore);
          } else setError(d.error || 'Yüklenemedi');
        })
        .catch((e) => {
          if (cancelled) return;
          logger.error('Hareketler fetch', e);
          setError('Sunucuya bağlanılamadı');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [code, type, iwasku, from, to, offset]);

  const resetFilters = () => {
    setType('');
    setIwasku('');
    setFrom('');
    setTo('');
    setOffset(0);
  };

  const filterActive = type || iwasku.trim() || from || to;

  return (
    <div className="space-y-5">
      <Link
        href={`/dashboard/depolar/${codeToSlug(code)}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <ChevronLeft className="w-4 h-4" /> {warehouseLabel(code)} Dashboard
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <History className="w-5 h-5 text-gray-500" /> Hareket Geçmişi
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          ShelfMovement audit log — tüm giriş, çıkış, transfer, düzeltme ve geri alma
          kayıtları.
        </p>
      </div>

      {/* Filtreler */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Tip</label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setOffset(0);
            }}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400 text-gray-900"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === '' ? 'Tümü' : TYPE_LABEL[t] ?? t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-0.5">iwasku</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={iwasku}
              onChange={(e) => {
                setIwasku(e.target.value);
                setOffset(0);
              }}
              placeholder="Tam eşleşme"
              className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:border-blue-400 text-gray-900 w-44"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Başlangıç</label>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setOffset(0);
            }}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Bitiş</label>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setOffset(0);
            }}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400 text-gray-900"
          />
        </div>
        {filterActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            <XIcon className="w-3 h-3" /> Filtreleri Temizle
          </button>
        )}
        <div className="ml-auto text-xs text-gray-500">
          {loading ? 'Yükleniyor…' : `${rows.length} / ${total}`}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-3 h-3" /> {error}
        </div>
      )}

      {/* Tablo */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        {rows.length === 0 && !loading ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            {filterActive ? 'Filtreyle eşleşen hareket yok.' : 'Hareket yok.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">Zaman</th>
                <th className="text-left px-3 py-2">Tip</th>
                <th className="text-left px-3 py-2">SKU</th>
                <th className="text-right px-3 py-2">Adet</th>
                <th className="text-left px-3 py-2">Kaynak</th>
                <th className="text-left px-3 py-2">Hedef</th>
                <th className="text-left px-3 py-2">Ref</th>
                <th className="text-left px-3 py-2">Kullanıcı</th>
                <th className="text-left px-3 py-2">Not / Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((m) => {
                const reversed = m.reversedByCount > 0;
                const isReversal = m.type === 'REVERSAL';
                return (
                  <tr
                    key={m.id}
                    className={`text-gray-700 ${reversed ? 'opacity-50' : ''}`}
                  >
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleString('tr-TR')}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${
                          isReversal
                            ? 'bg-purple-100 text-purple-700'
                            : m.type === 'OUTBOUND'
                            ? 'bg-red-100 text-red-700'
                            : m.type.startsWith('INBOUND')
                            ? 'bg-green-100 text-green-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {TYPE_LABEL[m.type] ?? m.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{m.iwasku ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{m.quantity ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">
                      {m.fromShelfCode ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">
                      {m.toShelfCode ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-500">
                      {m.refType ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[140px]">
                      {m.userName ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-[280px]">
                      {reversed && (
                        <span className="mr-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                          Geri alındı
                        </span>
                      )}
                      {m.notes ?? ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset(Math.max(0, offset - limit))}
          disabled={offset === 0 || loading}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-40"
        >
          ← Önceki
        </button>
        <span className="text-xs text-gray-500">
          {offset + 1}–{Math.min(offset + rows.length, total)} / {total}
        </span>
        <button
          type="button"
          onClick={() => setOffset(offset + limit)}
          disabled={!hasMore || loading}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-40"
        >
          Sonraki →
        </button>
      </div>
    </div>
  );
}
