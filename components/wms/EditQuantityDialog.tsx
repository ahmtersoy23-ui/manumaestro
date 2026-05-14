/**
 * Adet düzeltme modal'ı — ADMIN'e özel.
 * Mevcut adetin üzerine yeni adet yazılır, sebep girilir.
 * /adet-duzelt endpoint'ine STOCK veya BOX olarak gönderilir.
 *
 * Sayım flow'undan farklı: tek satır, sebep zorunlu, audit log ADJUSTMENT/MANUAL_EDIT.
 */

'use client';

import { useEffect, useState } from 'react';
import { X, Pencil, AlertCircle } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('EditQuantityDialog');

export type EditQtyTarget =
  | {
      kind: 'STOCK';
      shelfStockId: string;
      iwasku: string;
      productName: string | null;
      shelfCode: string;
      quantity: number;
      reservedQty: number;
    }
  | {
      kind: 'BOX';
      shelfBoxId: string;
      iwasku: string;
      productName: string | null;
      shelfCode: string;
      boxNumber: string;
      quantity: number;
      reservedQty: number;
    };

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  target: EditQtyTarget | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditQuantityDialog({ isOpen, warehouseCode, target, onClose, onSuccess }: Props) {
  const [newQty, setNewQty] = useState<string>('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setNewQty('');
        setReason('');
        setError(null);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && target) {
      setNewQty(String(target.quantity));
    }
  }, [isOpen, target]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, submitting]);

  if (!isOpen || !target) return null;

  const parsed = Number.parseInt(newQty, 10);
  const isInt = Number.isInteger(parsed) && parsed >= 0;
  const minQty = target.reservedQty;
  const aboveReserved = isInt && parsed >= minQty;
  const isNoop = isInt && parsed === target.quantity;
  const reasonValid = reason.trim().length >= 3;
  const canSubmit = isInt && aboveReserved && !isNoop && reasonValid && !submitting;

  const handleSubmit = async () => {
    setError(null);
    if (!isInt) {
      setError('Adet pozitif tam sayı olmalı.');
      return;
    }
    if (parsed < minQty) {
      setError(`Rezerve ${minQty} altına düşemez.`);
      return;
    }
    if (parsed === target.quantity) {
      setError('Yeni adet mevcut adetle aynı, değişiklik yok.');
      return;
    }
    if (!reasonValid) {
      setError('Sebep girin (en az 3 karakter).');
      return;
    }
    setSubmitting(true);
    try {
      const body =
        target.kind === 'STOCK'
          ? {
              type: 'STOCK',
              shelfStockId: target.shelfStockId,
              newQuantity: parsed,
              reason: reason.trim(),
            }
          : {
              type: 'BOX',
              shelfBoxId: target.shelfBoxId,
              newQuantity: parsed,
              reason: reason.trim(),
            };
      const res = await fetch(`/api/depolar/${warehouseCode}/adet-duzelt`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Adet düzeltme başarısız');
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Edit quantity submit', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  const diff = isInt ? parsed - target.quantity : 0;

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
          <h2 className="text-lg font-semibold text-amber-700 flex items-center gap-2">
            <Pencil className="w-5 h-5" /> Adet Düzelt
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

        <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-1 mb-3">
          <div className="text-sm font-semibold text-amber-900">Düzeltilecek kayıt</div>
          <div className="text-sm text-gray-800">
            <span className="font-mono text-xs">{target.iwasku}</span>
            {target.productName && (
              <span className="ml-2 text-gray-600">— {target.productName}</span>
            )}
          </div>
          <div className="text-xs text-gray-700">
            {target.kind === 'STOCK'
              ? `Tekil • ${target.shelfCode} • Mevcut ${target.quantity} adet`
              : `Koli ${target.boxNumber} @ ${target.shelfCode} • Mevcut ${target.quantity} adet`}
            {target.reservedQty > 0 && (
              <span className="ml-2 text-amber-700">(rezerve {target.reservedQty})</span>
            )}
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Yeni adet *</label>
          <input
            type="number"
            inputMode="numeric"
            min={target.reservedQty}
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
          />
          {isInt && !isNoop && (
            <div className="mt-1 text-[11px] text-gray-600">
              Fark:{' '}
              <span className={diff > 0 ? 'text-green-700' : 'text-red-700'}>
                {diff > 0 ? '+' : ''}
                {diff}
              </span>
            </div>
          )}
        </div>

        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Sebep (audit) *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Hatalı giriş, fire, hasar, sistem-fiziksel uyumsuzluğu…"
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2 mb-3">
            <AlertCircle className="w-3 h-3" /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-50"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-amber-600 hover:bg-amber-700 rounded-md disabled:opacity-50"
          >
            <Pencil className="w-4 h-4" />
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}
