/**
 * Toplu PDF etiket upload modal.
 *
 * Akış:
 *   1. PDF seç → client-side pdf-lib ile sayfa sayısı al
 *   2. Her sayfa için DRAFT sipariş seç (autocomplete) + ops. tracking
 *   3. "Yükle" → server PDF'i sayfalara böler, her birini ilgili siparişe
 *      OrderLabel olarak kaydeder
 *
 * pdf-lib lazy import — bundle size optimize.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Upload, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { createLogger } from '@/lib/logger';

const logger = createLogger('BulkLabelDialog');

type LabelType = 'SHIPPING' | 'FNSKU' | 'OTHER';

interface OrderRow {
  id: string;
  orderNumber: string;
  marketplaceCode: string;
  status: string;
}

interface UploadResultEntry {
  pageIndex: number;
  orderId: string;
}
interface UploadErrorEntry {
  pageIndex: number;
  orderId: string;
  error: string;
}

interface PageMapping {
  orderId: string | null;
  trackingNumber: string;
}

interface Props {
  warehouseCode: string;
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}

const MAX_BYTES = 10 * 1024 * 1024;

export function BulkLabelDialog({ warehouseCode, open, onClose, onCompleted }: Props) {
  const [type, setType] = useState<LabelType>('SHIPPING');
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [mappings, setMappings] = useState<PageMapping[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: UploadResultEntry[]; errors: UploadErrorEntry[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/depolar/${warehouseCode}/siparis?status=DRAFT`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setOrders(d.data.orders);
      })
      .catch((e) => logger.error('Order list', e));
    return () => {
      cancelled = true;
    };
  }, [warehouseCode, open]);

  function reset() {
    setFile(null);
    setPageCount(0);
    setMappings([]);
    setError(null);
    setResult(null);
    setType('SHIPPING');
  }

  async function handleFileChange(f: File | null) {
    setError(null);
    setResult(null);
    if (!f) {
      setFile(null);
      setPageCount(0);
      setMappings([]);
      return;
    }
    if (f.type !== 'application/pdf') {
      setError('Sadece PDF kabul edilir');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`Dosya 10MB'dan büyük (${(f.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
    setFile(f);
    setParsing(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const buf = await f.arrayBuffer();
      const doc = await PDFDocument.load(buf);
      const count = doc.getPageCount();
      setPageCount(count);
      setMappings(Array.from({ length: count }, () => ({ orderId: null, trackingNumber: '' })));
    } catch (e) {
      logger.error('PDF parse', e);
      setError('PDF okunamadı');
      setFile(null);
      setPageCount(0);
    } finally {
      setParsing(false);
    }
  }

  function setMapping(idx: number, patch: Partial<PageMapping>) {
    setMappings((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }

  const allMapped = mappings.length > 0 && mappings.every((m) => m.orderId !== null);

  async function handleSubmit() {
    if (!file || !allMapped) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', type);
      fd.append(
        'mapping',
        JSON.stringify(
          mappings.map((m, i) => ({
            pageIndex: i,
            orderId: m.orderId,
            trackingNumber: m.trackingNumber.trim() || undefined,
          }))
        )
      );
      const res = await fetch(`/api/depolar/${warehouseCode}/labels/bulk`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        setError(d.error || 'Yükleme başarısız');
        return;
      }
      setResult({ created: d.created || [], errors: d.errors || [] });
      if ((d.errors?.length ?? 0) === 0) {
        onCompleted();
      }
    } catch (e) {
      logger.error('Bulk submit', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Toplu Etiket Yükleme (PDF)</h2>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {!result && (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as LabelType)}
                  disabled={!!file || submitting}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
                >
                  <option value="SHIPPING">Kargo Etiketi</option>
                  <option value="FNSKU">FNSKU</option>
                  <option value="OTHER">Diğer</option>
                </select>
                <label
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md cursor-pointer ${
                    parsing
                      ? 'bg-gray-100 text-gray-400 cursor-wait'
                      : file
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {parsing ? 'PDF ayrıştırılıyor…' : file ? `📄 ${file.name}` : 'PDF Seç'}
                  <input
                    type="file"
                    accept="application/pdf"
                    disabled={parsing || submitting}
                    className="hidden"
                    onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                  />
                </label>
                {file && (
                  <button
                    type="button"
                    onClick={() => handleFileChange(null)}
                    disabled={submitting}
                    className="text-xs text-gray-600 hover:text-gray-900 underline"
                  >
                    Temizle
                  </button>
                )}
                <span className="text-xs text-gray-500">
                  {pageCount > 0 ? `${pageCount} sayfa` : 'PDF / max 10MB'}
                </span>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {error}
                </div>
              )}

              {pageCount > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs text-gray-600 font-medium">
                    Her sayfa için sipariş seç ({mappings.filter((m) => m.orderId).length}/{pageCount} eşlendi)
                  </div>
                  <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-72 overflow-y-auto">
                    {mappings.map((m, i) => (
                      <PageMappingRow
                        key={i}
                        pageIndex={i}
                        mapping={m}
                        orders={orders}
                        showTracking={type === 'SHIPPING'}
                        onChange={(patch) => setMapping(i, patch)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                {result.created.length} etiket yüklendi
                {result.errors.length > 0 && (
                  <span className="text-amber-700 ml-2">
                    · {result.errors.length} sayfa hata aldı
                  </span>
                )}
              </div>
              {result.errors.length > 0 && (
                <ul className="text-xs text-red-700 space-y-1">
                  {result.errors.map((e) => (
                    <li key={`${e.pageIndex}-${e.orderId}`}>
                      Sayfa {e.pageIndex + 1} → {e.orderId}: {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
          {result ? (
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Kapat
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={handleClose} disabled={submitting}>
                İptal
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                loading={submitting}
                disabled={!file || !allMapped || submitting}
                icon={!submitting ? <Upload className="w-4 h-4" /> : undefined}
              >
                {pageCount > 0 ? `${pageCount} sayfayı yükle` : 'Yükle'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface PageMappingRowProps {
  pageIndex: number;
  mapping: PageMapping;
  orders: OrderRow[];
  showTracking: boolean;
  onChange: (patch: Partial<PageMapping>) => void;
}

function PageMappingRow({ pageIndex, mapping, orders, showTracking, onChange }: PageMappingRowProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === mapping.orderId) ?? null,
    [mapping.orderId, orders]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orders.slice(0, 50);
    return orders
      .filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.marketplaceCode.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [searchQuery, orders]);

  return (
    <div className="px-3 py-2 flex items-center gap-3 text-sm">
      <span className="w-12 text-xs font-medium text-gray-500 shrink-0">Sayfa {pageIndex + 1}</span>
      <div className="flex-1 min-w-0">
        {selectedOrder ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-900 truncate">
              {selectedOrder.orderNumber}
            </span>
            <span className="text-[10px] text-gray-500">{selectedOrder.marketplaceCode}</span>
            <button
              type="button"
              onClick={() => {
                onChange({ orderId: null });
                setSearchQuery('');
              }}
              className="text-[11px] text-blue-600 hover:underline"
            >
              değiştir
            </button>
          </div>
        ) : (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onChange({ orderId: e.target.value });
            }}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1 bg-white"
          >
            <option value="">— Sipariş seç —</option>
            {filtered.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber} · {o.marketplaceCode}
              </option>
            ))}
          </select>
        )}
      </div>
      {showTracking && selectedOrder && (
        <input
          type="text"
          value={mapping.trackingNumber}
          onChange={(e) => onChange({ trackingNumber: e.target.value })}
          placeholder="tracking (ops.)"
          className="w-32 text-xs border border-gray-300 rounded px-1.5 py-1 font-mono"
        />
      )}
    </div>
  );
}
