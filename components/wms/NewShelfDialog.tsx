/**
 * Yeni Raf Yarat (tekil) — modal.
 * Backend: POST /api/depolar/[code]/raflar
 */

'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('NewShelfDialog');

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function NewShelfDialog({ isOpen, warehouseCode, onClose, onSuccess }: Props) {
  const [code, setCode] = useState('');
  const [shelfType, setShelfType] = useState<'POOL' | 'TEMP' | 'NORMAL'>('NORMAL');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setError(null);
    if (!code.trim()) {
      setError('Raf kodu boş olamaz');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/raflar`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), shelfType, notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Raf yaratılamadı');
        return;
      }
      // Başarılı — kapat + yenile
      setCode('');
      setNotes('');
      setShelfType('NORMAL');
      onSuccess();
      onClose();
    } catch (e) {
      logger.error('Yeni raf hatası', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Yeni Raf — {warehouseCode}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Raf kodu *</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="örn. H1-B veya A5-C2"
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tip</label>
            <div className="flex gap-1 text-xs">
              {(['NORMAL', 'POOL', 'TEMP'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setShelfType(t)}
                  className={`px-3 py-1.5 rounded-md font-medium ${
                    shelfType === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t === 'NORMAL' ? 'Normal' : t === 'POOL' ? 'Havuz' : 'Geçici'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Not (opsiyonel)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              disabled={submitting}
            >
              İptal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            >
              {submitting ? 'Yaratılıyor…' : 'Yarat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
