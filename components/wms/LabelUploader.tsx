/**
 * Sipariş etiket yöneticisi — kargo PDF / FNSKU / diğer etiketleri yükle, listele, bas, sil.
 * Kullanıcı rolü: PACKER+ yükleyebilir/basabilir, MANAGER+ silebilir.
 */

'use client';

import { useEffect, useState } from 'react';
import { Upload, FileText, Trash2, Printer, Download, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { notify } from '@/lib/ui/notify';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const logger = createLogger('LabelUploader');

type LabelType = 'SHIPPING' | 'FNSKU' | 'OTHER';

const TYPE_LABEL: Record<LabelType, string> = {
  SHIPPING: 'Kargo',
  FNSKU: 'FNSKU',
  OTHER: 'Diğer',
};

const TYPE_BADGE: Record<LabelType, string> = {
  SHIPPING: 'bg-blue-100 text-blue-700',
  FNSKU: 'bg-orange-100 text-orange-700',
  OTHER: 'bg-gray-100 text-gray-700',
};

interface LabelDto {
  id: string;
  type: LabelType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  printedAt: string | null;
  shipmentBoxId: string | null;
  notes: string | null;
  trackingNumber: string | null;
  archivedAt: string | null;
}

interface Props {
  warehouseCode: string;
  orderId: string;
  role: string; // VIEWER/PACKER/OPERATOR/MANAGER/ADMIN
}

const ACCEPT_MIME = 'application/pdf,image/png,image/jpeg';
const MAX_BYTES = 10 * 1024 * 1024;

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function LabelUploader({ warehouseCode, orderId, role }: Props) {
  const confirm = useConfirm();
  const [labels, setLabels] = useState<LabelDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState<LabelType>('SHIPPING');
  const [uploadTracking, setUploadTracking] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingTrackingId, setEditingTrackingId] = useState<string | null>(null);
  const [editingTrackingValue, setEditingTrackingValue] = useState<string>('');

  const canUpload = ['PACKER', 'OPERATOR', 'MANAGER', 'ADMIN'].includes(role);
  const canPrint = canUpload;
  const canDelete = ['MANAGER', 'ADMIN'].includes(role);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/depolar/${warehouseCode}/siparis/${orderId}/labels`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setLabels(d.data);
        else setError(d.error || 'Yüklenemedi');
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('Etiket fetch', e);
        setError('Sunucuya bağlanılamadı');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [warehouseCode, orderId, refreshKey]);

  async function handleUpload(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(`Dosya 10MB'dan büyük (${formatBytes(file.size)})`);
      return;
    }
    if (!ACCEPT_MIME.split(',').includes(file.type)) {
      setError(`Desteklenmeyen tip: ${file.type}. PDF/PNG/JPG yükleyin.`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', uploadType);
      if (uploadTracking.trim().length > 0) fd.append('trackingNumber', uploadTracking.trim());
      const res = await fetch(`/api/depolar/${warehouseCode}/siparis/${orderId}/labels`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        setError(d.error || 'Yükleme başarısız');
        return;
      }
      setUploadTracking('');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Label upload', e);
      setError('Sunucu hatası');
    } finally {
      setUploading(false);
    }
  }

  async function saveTracking(labelId: string, value: string) {
    try {
      const res = await fetch(
        `/api/depolar/${warehouseCode}/siparis/${orderId}/labels/${labelId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'updateTracking', trackingNumber: value }),
        }
      );
      const d = await res.json();
      if (!res.ok || !d.success) {
        notify.error(d.error || 'Tracking güncellenemedi');
        return;
      }
      setEditingTrackingId(null);
      setEditingTrackingValue('');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Update tracking', e);
      notify.error('Sunucu hatası', e);
    }
  }

  async function handleDelete(labelId: string) {
    const ok = await confirm({
      title: 'Etiketi sil?',
      message: 'Bu işlem geri alınamaz.',
      confirmLabel: 'Sil',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/depolar/${warehouseCode}/siparis/${orderId}/labels/${labelId}`,
        { method: 'DELETE', credentials: 'include' }
      );
      const d = await res.json();
      if (!res.ok || !d.success) {
        notify.error(d.error || 'Silinemedi');
        return;
      }
      notify.success('Etiket silindi');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Label delete', e);
      notify.error('Sunucu hatası', e);
    }
  }

  async function handlePrint(labelId: string) {
    try {
      const printUrl = `/api/labels/${labelId}/download`;
      window.open(printUrl, '_blank', 'noopener,noreferrer');

      const res = await fetch(
        `/api/depolar/${warehouseCode}/siparis/${orderId}/labels/${labelId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'print' }),
        }
      );
      const d = await res.json();
      if (!res.ok || !d.success) {
        logger.warn('Print mark failed', d);
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      logger.error('Print', e);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500" />
          Etiketler {labels && labels.length > 0 && `(${labels.length})`}
        </h2>
      </div>

      {canUpload && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/40 flex items-center gap-3 flex-wrap">
          <select
            value={uploadType}
            onChange={(e) => setUploadType(e.target.value as LabelType)}
            disabled={uploading}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
          >
            <option value="SHIPPING">Kargo Etiketi</option>
            <option value="FNSKU">FNSKU</option>
            <option value="OTHER">Diğer</option>
          </select>
          {uploadType === 'SHIPPING' && (
            <input
              type="text"
              value={uploadTracking}
              onChange={(e) => setUploadTracking(e.target.value)}
              disabled={uploading}
              placeholder="Tracking no (ops.)"
              className="w-44 text-sm border border-gray-300 rounded-md px-2 py-1.5 font-mono bg-white"
            />
          )}
          <label
            className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md cursor-pointer ${
              uploading
                ? 'bg-gray-100 text-gray-400 cursor-wait'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Yükleniyor…' : 'Dosya Seç'}
            <input
              type="file"
              accept={ACCEPT_MIME}
              disabled={uploading}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = '';
              }}
            />
          </label>
          <span className="text-xs text-gray-500">PDF / PNG / JPG · max 10MB · Kargo: 14 gün sonra arşivlenir</span>
        </div>
      )}

      {error && (
        <div className="mx-4 my-3 bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="px-4 py-6 text-sm text-gray-400 text-center">Yükleniyor…</div>
      ) : labels && labels.length === 0 ? (
        <div className="px-4 py-6 text-sm text-gray-400 text-center">
          Henüz etiket yüklenmemiş.
        </div>
      ) : labels ? (
        <ul className="divide-y divide-gray-100">
          {labels.map((label) => (
            <li key={label.id} className={`px-4 py-2.5 flex items-center gap-3 text-sm ${label.archivedAt ? 'opacity-60' : ''}`}>
              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-medium ${TYPE_BADGE[label.type]}`}>
                {TYPE_LABEL[label.type]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-gray-800 truncate" title={label.fileName}>
                  {label.fileName}
                  {label.archivedAt && (
                    <span className="ml-2 text-[10px] uppercase px-1 py-0.5 rounded bg-gray-200 text-gray-600">
                      arşivlendi
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>{formatBytes(label.fileSize)}</span>
                  <span>·</span>
                  <span>{new Date(label.uploadedAt).toLocaleString('tr-TR')}</span>
                  {label.printedAt && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5 text-green-700">
                        <CheckCircle2 className="w-3 h-3" />
                        Basıldı
                      </span>
                    </>
                  )}
                </div>
                {/* Tracking number — kargo etiketleri için her zaman görünür / düzenlenebilir */}
                {label.type === 'SHIPPING' && (
                  <div className="mt-1 flex items-center gap-2">
                    {editingTrackingId === label.id ? (
                      <>
                        <input
                          type="text"
                          autoFocus
                          value={editingTrackingValue}
                          onChange={(e) => setEditingTrackingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveTracking(label.id, editingTrackingValue);
                            if (e.key === 'Escape') { setEditingTrackingId(null); setEditingTrackingValue(''); }
                          }}
                          placeholder="Tracking no"
                          className="text-xs border border-gray-300 rounded px-1.5 py-0.5 font-mono w-44"
                        />
                        <button
                          onClick={() => saveTracking(label.id, editingTrackingValue)}
                          className="text-[10px] px-1.5 py-0.5 bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Kaydet
                        </button>
                        <button
                          onClick={() => { setEditingTrackingId(null); setEditingTrackingValue(''); }}
                          className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                        >
                          İptal
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (!canUpload) return;
                          setEditingTrackingId(label.id);
                          setEditingTrackingValue(label.trackingNumber ?? '');
                        }}
                        className={`text-[11px] font-mono ${
                          label.trackingNumber
                            ? 'text-gray-700'
                            : 'text-blue-600 italic'
                        } ${canUpload ? 'hover:underline cursor-pointer' : 'cursor-default'}`}
                        disabled={!canUpload}
                      >
                        {label.trackingNumber ? `📦 ${label.trackingNumber}` : (canUpload ? '+ Tracking ekle' : '')}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {!label.archivedAt && (
                  <a
                    href={`/api/labels/${label.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
                    title="İndir / Görüntüle"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                )}
                {canPrint && !label.archivedAt && (
                  <button
                    onClick={() => handlePrint(label.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
                    title="Yeni sekmede aç + basıldı işaretle"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Bas
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => handleDelete(label.id)}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                    title="Sil"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
