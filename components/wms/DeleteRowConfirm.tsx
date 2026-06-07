/**
 * Sil onay modal'ı — target önceden belli (raf detayından satır seçildi).
 * Sebep yazılır, /sil endpoint'ine STOCK veya BOX olarak gönderilir.
 *
 * DeleteStockDialog'ın 3-step flow'undan farklı: bu single-step, target
 * dışarıdan inject edilir (raf detayında satır tıklandığında).
 */

'use client';

import { useEffect, useState } from 'react';
import { X, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DeleteRowConfirm');

export type DeleteRowTarget =
  | {
      kind: 'STOCK';
      shelfStockId: string;
      iwasku: string;
      productName: string | null;
      shelfCode: string;
      quantity: number;
    }
  | {
      kind: 'BOX';
      shelfBoxId: string;
      iwasku: string;
      productName: string | null;
      shelfCode: string;
      boxNumber: string;
      quantity: number;
    };

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  target: DeleteRowTarget | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteRowConfirm({ isOpen, warehouseCode, target, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setReason('');
        setError(null);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, submitting]);

  if (!isOpen || !target) return null;

  const handleSubmit = async () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError('Sebep girin (en az 3 karakter).');
      return;
    }
    setSubmitting(true);
    try {
      const body =
        target.kind === 'STOCK'
          ? { type: 'STOCK', shelfStockId: target.shelfStockId, reason: reason.trim() }
          : { type: 'BOX', shelfBoxId: target.shelfBoxId, reason: reason.trim() };
      const res = await fetch(`/api/depolar/${warehouseCode}/sil`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Silinemedi');
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Delete row submit', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 text-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-red-700 flex items-center gap-2">
            <Trash2 className="w-5 h-5" /> Sil
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Kapat"
            className="p-1 hover:bg-gray-100 rounded disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-red-50 border border-red-200 rounded p-3 space-y-1 mb-3">
          <div className="text-sm font-semibold text-red-900">Silinecek kayıt</div>
          <div className="text-sm text-gray-800">
            <span className="font-mono text-xs">{target.iwasku}</span>
            {target.productName && (
              <span className="ml-2 text-gray-600">— {target.productName}</span>
            )}
          </div>
          <div className="text-xs text-gray-700">
            {target.kind === 'STOCK'
              ? `Tekil • ${target.shelfCode} • ${target.quantity} adet`
              : `Koli ${target.boxNumber} @ ${target.shelfCode} • ${target.quantity} adet`}
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Sebep (audit) *
          </label>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Hatalı giriş, fire, hasar…"
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2 mb-3">
            <AlertCircle className="w-3 h-3" /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            İptal
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleSubmit}
            loading={submitting}
            disabled={submitting || reason.trim().length < 3}
            icon={!submitting ? <Trash2 className="w-4 h-4" /> : undefined}
          >
            {submitting ? 'Siliniyor…' : 'Kalıcı Olarak Sil'}
          </Button>
        </div>
      </div>
    </div>
  );
}
