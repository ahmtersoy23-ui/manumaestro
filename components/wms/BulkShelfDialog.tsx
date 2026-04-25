/**
 * Toplu Raf Yarat — modal.
 * Backend: POST /api/depolar/[code]/raflar/bulk
 */

'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('BulkShelfDialog');

interface Props {
  isOpen: boolean;
  warehouseCode: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function BulkShelfDialog({ isOpen, warehouseCode, onClose, onSuccess }: Props) {
  const [codesText, setCodesText] = useState('');
  const [shelfType, setShelfType] = useState<'POOL' | 'TEMP' | 'NORMAL'>('NORMAL');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<null | { created: number; skipped: number; total: number; skippedCodes?: string[] }>(null);

  if (!isOpen) return null;

  // Live preview
  const codes = codesText
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const uniqueCount = new Set(codes).size;

  const handleSubmit = async () => {
    setError(null);
    setResult(null);
    if (codes.length === 0) {
      setError('En az bir raf kodu girin');
      return;
    }
    if (codes.length > 500) {
      setError('Tek seferde en fazla 500 raf yaratılabilir');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/depolar/${warehouseCode}/raflar/bulk`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes, shelfType }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Toplu yaratım başarısız');
        return;
      }
      setResult(data.data);
      if (data.data.created > 0) onSuccess();
    } catch (e) {
      logger.error('Bulk raf hatası', e);
      setError('Sunucu hatası');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setCodesText('');
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Toplu Raf Yarat — {warehouseCode}</h2>
          <button onClick={handleClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Raf kodları — her satıra bir kod (veya virgülle ayır)
            </label>
            <textarea
              value={codesText}
              onChange={(e) => setCodesText(e.target.value)}
              rows={8}
              placeholder={`A1-A1\nA1-A2\nA1-B\n...`}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:border-blue-400"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              {codes.length} satır, {uniqueCount} farklı kod (mevcut olanlar atlanır)
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tip (hepsine aynı)</label>
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

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">{error}</div>
          )}

          {result && (
            <div className="bg-green-50 border border-green-200 rounded p-3 text-xs text-green-800 space-y-1">
              <p className="font-medium">
                ✓ {result.created} yeni raf yaratıldı{result.skipped > 0 && `, ${result.skipped} mevcut atlandı`}
              </p>
              {result.skippedCodes && result.skippedCodes.length > 0 && (
                <p className="font-mono text-[10px] text-green-700">
                  Atlanan: {result.skippedCodes.join(', ')}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              disabled={submitting}
            >
              {result ? 'Kapat' : 'İptal'}
            </button>
            {!result && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || codes.length === 0}
                className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Yaratılıyor…' : `Yarat (${uniqueCount})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
