/**
 * Sayım Detay — başlat, blind count gir, tamamla, discrepancy resolve.
 */

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ChevronLeft, AlertCircle, Play, CheckCircle2, Loader2, Box as BoxIcon, Package, Eye, EyeOff } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SayimDetay');

interface Item {
  id: string;
  iwasku: string;
  productName: string | null;
  source: 'STOCK' | 'BOX';
  shelfStockId: string | null;
  shelfBoxId: string | null;
  systemQty: number | null; // null = blind, görmüyor
  countedQty: number | null;
  diffQty: number | null;
  resolution: string | null;
}

interface TaskData {
  role: string;
  blind: boolean;
  task: {
    id: string;
    shelfId: string;
    shelfCode: string;
    shelfType: string;
    abcClass: string | null;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISCREPANCY';
    scheduledFor: string;
    toleranceQty: number;
    startedAt: string | null;
    completedAt: string | null;
    notes: string | null;
  };
  items: Item[];
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  DISCREPANCY: 'bg-red-100 text-red-700',
};

export default function SayimDetayPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code: rawCode, id } = use(params);
  const code = rawCode.toUpperCase();

  const [data, setData] = useState<TaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/depolar/${code}/sayim/${id}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setData(d.data);
        else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Detay fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, id, refreshKey]);

  async function startCount() {
    if (!confirm('Sayım başlatılacak — şu an raftaki içerik snapshot alınacak. Onaylıyor musun?')) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${code}/sayim/${id}/start`, {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        alert(d.error || 'Başlatılamadı');
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Start', e);
      alert('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCount(itemId: string, qty: number) {
    try {
      const res = await fetch(`/api/depolar/${code}/sayim/${id}/items/${itemId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'count', countedQty: qty }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        alert(d.error || 'Kayıt başarısız');
        return false;
      }
      setRefreshKey((k) => k + 1);
      return true;
    } catch (e) {
      logger.error('Count submit', e);
      alert('Sunucu hatası');
      return false;
    }
  }

  async function complete() {
    if (!confirm('Tüm kalemler sayıldı mı? Tamamla aksiyonu sayım durumunu kilitler.')) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${code}/sayim/${id}/complete`, {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        alert(d.error || 'Tamamlanamadı');
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Complete', e);
      alert('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveItem(itemId: string, resolution: 'ACCEPT' | 'INVESTIGATE' | 'IGNORE') {
    const label =
      resolution === 'ACCEPT'
        ? 'Sayılan miktarı kabul et — sistemdeki quantity güncellenecek + adjustment hareketi yazılacak.'
        : resolution === 'INVESTIGATE'
        ? 'İnceleme moduna alınacak (sistem quantity değişmez).'
        : 'Yok say — adjust yapılmayacak.';
    if (!confirm(label)) return;
    try {
      const res = await fetch(`/api/depolar/${code}/sayim/${id}/items/${itemId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', resolution }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        alert(d.error || 'Resolve başarısız');
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Resolve', e);
      alert('Sunucu hatası');
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Yükleniyor…</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  if (!data) return null;

  const canPerform = ['PACKER', 'OPERATOR', 'MANAGER', 'ADMIN'].includes(data.role);
  const canResolve = ['MANAGER', 'ADMIN'].includes(data.role);
  const canStart = canPerform && data.task.status === 'PENDING';
  const canComplete =
    canPerform &&
    data.task.status === 'IN_PROGRESS' &&
    data.items.length > 0 &&
    data.items.every((it) => it.countedQty !== null);

  return (
    <div className="space-y-5">
      <Link
        href={`/dashboard/depolar/${code}/sayim`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <ChevronLeft className="w-4 h-4" /> Sayım Listesi
      </Link>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${STATUS_BADGE[data.task.status]}`}>
                {data.task.status}
              </span>
              {data.task.abcClass && (
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded font-bold bg-gray-100 text-gray-700">
                  Sınıf {data.task.abcClass}
                </span>
              )}
              <span className="text-[10px] text-gray-500">tolerans ±{data.task.toleranceQty}</span>
            </div>
            <h1 className="text-xl font-bold font-mono text-gray-900">{data.task.shelfCode}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {data.task.shelfType} •{' '}
              {new Date(data.task.scheduledFor).toLocaleDateString('tr-TR')}
              {data.task.startedAt && (
                <> • Başladı: {new Date(data.task.startedAt).toLocaleString('tr-TR')}</>
              )}
              {data.task.completedAt && (
                <> • Bitti: {new Date(data.task.completedAt).toLocaleString('tr-TR')}</>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            {canStart && (
              <button
                onClick={startCount}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Sayımı Başlat
              </button>
            )}
            {canComplete && (
              <button
                onClick={complete}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                Tamamla ({data.items.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Blind uyarısı */}
      {data.blind && data.task.status === 'IN_PROGRESS' && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900 flex items-center gap-2">
          <EyeOff className="w-4 h-4" />
          Blind sayım: sistem miktarları kullanıcıya gösterilmiyor — gözünle say, miktarı gir.
        </div>
      )}

      {/* Items */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Kalemler ({data.items.length})</h2>
        </div>
        {data.items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400 text-center">
            Henüz kalem yok. {data.task.status === 'PENDING' && 'Sayımı başlat ki snapshot alınsın.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                tolerance={data.task.toleranceQty}
                taskStatus={data.task.status}
                canPerform={canPerform}
                canResolve={canResolve}
                onCount={(qty) => submitCount(item.id, qty)}
                onResolve={(res) => resolveItem(item.id, res)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ItemRowProps {
  item: Item;
  tolerance: number;
  taskStatus: string;
  canPerform: boolean;
  canResolve: boolean;
  onCount: (qty: number) => Promise<boolean>;
  onResolve: (resolution: 'ACCEPT' | 'INVESTIGATE' | 'IGNORE') => Promise<void>;
}

function ItemRow({ item, tolerance, taskStatus, canPerform, canResolve, onCount, onResolve }: ItemRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const isCounted = item.countedQty !== null;
  const diff = item.countedQty !== null && item.systemQty !== null
    ? item.countedQty - item.systemQty
    : item.diffQty;
  const exceedsTolerance = diff !== null && Math.abs(diff) > tolerance;

  const canEdit = canPerform && taskStatus === 'IN_PROGRESS';
  const canResolveItem =
    canResolve &&
    taskStatus === 'DISCREPANCY' &&
    item.resolution === null &&
    isCounted &&
    exceedsTolerance;

  async function saveCount() {
    const qty = Math.max(0, Math.floor(Number(value)));
    if (!Number.isFinite(qty)) {
      alert('Geçersiz miktar');
      return;
    }
    setSaving(true);
    const ok = await onCount(qty);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setValue('');
    }
  }

  return (
    <li className="px-4 py-2.5 flex items-center gap-3 text-sm">
      {item.source === 'STOCK' ? (
        <Package className="w-4 h-4 text-gray-400" />
      ) : (
        <BoxIcon className="w-4 h-4 text-gray-400" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-gray-900">{item.iwasku}</span>
          {item.productName && (
            <span className="text-xs text-gray-500 truncate">{item.productName}</span>
          )}
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2">
          {/* Sistem miktarı sadece blind değilken görünür */}
          {item.systemQty !== null && (
            <span>
              <Eye className="w-3 h-3 inline-block mr-0.5" /> sistem: {item.systemQty}
            </span>
          )}
          {isCounted && (
            <span className={exceedsTolerance ? 'text-red-700 font-medium' : 'text-emerald-700'}>
              sayılan: {item.countedQty}
              {diff !== null && (
                <span className="ml-1">
                  ({diff > 0 ? '+' : ''}
                  {diff})
                </span>
              )}
            </span>
          )}
          {item.resolution && (
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
              {item.resolution}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {editing && canEdit ? (
          <>
            <input
              type="number"
              min="0"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCount();
                if (e.key === 'Escape') {
                  setEditing(false);
                  setValue('');
                }
              }}
              className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-right"
            />
            <button
              onClick={saveCount}
              disabled={saving}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '…' : 'Kaydet'}
            </button>
            <button
              onClick={() => { setEditing(false); setValue(''); }}
              className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              İptal
            </button>
          </>
        ) : canEdit ? (
          <button
            onClick={() => {
              setEditing(true);
              setValue(item.countedQty !== null ? String(item.countedQty) : '');
            }}
            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            {isCounted ? 'Düzelt' : 'Say'}
          </button>
        ) : null}

        {canResolveItem && (
          <>
            <button
              onClick={() => onResolve('ACCEPT')}
              className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"
              title="Sayılanı kabul et + sistem güncelle + audit log"
            >
              Kabul
            </button>
            <button
              onClick={() => onResolve('INVESTIGATE')}
              className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700"
            >
              İncele
            </button>
            <button
              onClick={() => onResolve('IGNORE')}
              className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Yok say
            </button>
          </>
        )}
      </div>
    </li>
  );
}
