/**
 * Raf düzenle (admin) — code rename + isActive toggle + notes inline edit.
 * Backend: PATCH /api/depolar/[code]/raflar/[shelfId]
 *
 * Pasif yapma: rezerve > 0 olan raflarda backend reddeder (uyarı).
 * Code rename: warehouseCode + code unique constraint, çakışma 409.
 */

'use client';

import { useEffect, useState } from 'react';
import { X, AlertCircle, Settings } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('EditShelfDialog');

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  shelf: {
    id: string;
    code: string;
    shelfType: string;
    isActive?: boolean;
    notes: string | null;
  } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditShelfDialog({ isOpen, warehouseCode, shelf, onClose, onSuccess }: Props) {
  const [code, setCode] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !shelf) return;
    setCode(shelf.code);
    setIsActive(shelf.isActive ?? true);
    setNotes(shelf.notes ?? '');
    setError(null);
  }, [isOpen, shelf]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, submitting]);

  if (!isOpen || !shelf) return null;

  const dirty =
    code !== shelf.code ||
    isActive !== (shelf.isActive ?? true) ||
    notes !== (shelf.notes ?? '');

  const handleSubmit = async () => {
    setError(null);
    if (!code.trim()) {
      setError('Raf kodu boş olamaz');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/raflar/${shelf.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim() !== shelf.code ? code.trim() : undefined,
          isActive: isActive !== (shelf.isActive ?? true) ? isActive : undefined,
          notes:
            (notes || null) !== (shelf.notes ?? null)
              ? notes.trim() || null
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Güncellenemedi');
        return;
      }
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Edit shelf submit', e);
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
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Settings className="w-5 h-5 text-gray-500" /> Rafı Düzenle
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

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Raf Kodu</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:border-blue-400"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Tip: <span className="font-semibold">{shelf.shelfType}</span> (değiştirilemez)
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notlar</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Rafa özgü açıklama (opsiyonel)"
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded"
            />
            <span className="text-gray-700">
              Aktif{' '}
              <span className="text-[11px] text-gray-500">
                (pasif rafa yeni hareket yapılamaz; mevcut stok korunur)
              </span>
            </span>
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-3 h-3" /> {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
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
              disabled={submitting || !dirty}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            >
              {submitting ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
