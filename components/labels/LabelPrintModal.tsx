'use client';

/**
 * Etiket basım modalı.
 *
 * Adet seç → /api/labels/generate'a POST → dönen serials array ile
 * client-side popup aç (lib/labels/productLabel.ts) → 100x30mm QR etiketleri
 * yazıcıdan basılır.
 */

import { useState } from 'react';
import { X, Loader2, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { openProductLabelPopup } from '@/lib/labels/productLabel';

interface LabelPrintModalProps {
  iwasku: string;
  productName: string;
  defaultQuantity?: number;
  onClose: () => void;
}

export function LabelPrintModal({ iwasku, productName, defaultQuantity, onClose }: LabelPrintModalProps) {
  const [quantity, setQuantity] = useState<number>(defaultQuantity && defaultQuantity > 0 ? defaultQuantity : 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || quantity < 1) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/labels/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iwasku, productName, quantity }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Etiket uretilemedi');
      }
      const serials: string[] = json.data.serials;
      // Her seri için inline QR data URL üret — popup self-contained, CDN bağımlılığı yok
      const entries = await Promise.all(
        serials.map(async (fullBarcode) => ({
          fullBarcode,
          qrDataUrl: await QRCode.toDataURL(fullBarcode, {
            width: 200,
            margin: 0,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' },
          }),
        }))
      );
      openProductLabelPopup({ iwasku, productName, entries });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Printer className="w-5 h-5 text-purple-600" />
            Etiket Bas
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <p className="text-xs text-gray-500 font-mono">{iwasku}</p>
            <p className="text-sm text-gray-800 font-medium mt-0.5 line-clamp-2">{productName}</p>
          </div>

          <div>
            <label htmlFor="qty" className="block text-sm font-semibold text-gray-700 mb-1.5">
              Adet
            </label>
            <input
              id="qty"
              type="number"
              min={1}
              max={1000}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
              autoFocus
              className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-md text-lg text-center focus:outline-none focus:border-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              100×30 mm QR etiket — sol QR + sağ ürün adı + iwasku-serial
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-semibold rounded-md flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Üretiliyor...
                </>
              ) : (
                <>
                  <Printer className="w-4 h-4" />
                  Seri No Üret ve Hazırla
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-md disabled:opacity-50"
            >
              İptal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
