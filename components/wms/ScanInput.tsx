/**
 * Reusable barcode scanner input — kamera + manuel fallback.
 *
 * Kullanım:
 *   <ScanInput value={shelfFilter} onChange={setShelfFilter} placeholder="örn. NJ-A-01" />
 *
 * Davranış:
 *   - "Tara" butonu → kamera modal açılır (zxing browser)
 *   - Barkod okunduğunda value setlenir, modal kapanır
 *   - Kamera yok / izin yok → "kullanılamıyor" gösterir, manuel input kalır
 *   - Manuel klavye girişi her zaman çalışır (HID Bluetooth scanner için ideal)
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, X, Loader2 } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ScanInput');

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
  /** Kamera taraması ile alınan değer manuel input yerine direkt callback'e gitsin (form submit gibi) */
  onScan?: (code: string) => void;
}

export function ScanInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  label,
  onScan,
}: Props) {
  const [scanOpen, setScanOpen] = useState(false);

  function handleScan(code: string) {
    setScanOpen(false);
    if (onScan) onScan(code);
    else onChange(code);
  }

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      {label && <span className="text-xs text-gray-700">{label}</span>}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="px-2 py-1 border border-gray-300 rounded text-sm font-mono flex-1 min-w-0"
      />
      <button
        type="button"
        onClick={() => setScanOpen(true)}
        disabled={disabled}
        className="p-1.5 text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded disabled:opacity-50"
        title="Kamera ile tara"
      >
        <Camera className="w-4 h-4" />
      </button>
      {scanOpen && (
        <ScanModal onClose={() => setScanOpen(false)} onScan={handleScan} />
      )}
    </div>
  );
}

interface ModalProps {
  onClose: () => void;
  onScan: (code: string) => void;
}

function ScanModal({ onClose, onScan }: ModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        if (cancelled) return;
        const videoEl = videoRef.current;
        if (!videoEl) return;
        const controls = await reader.decodeFromVideoDevice(undefined, videoEl, (result) => {
          if (cancelled) return;
          if (result) {
            const text = result.getText();
            if (text && text.length > 0) {
              onScan(text);
            }
          }
        });
        controlsRef.current = controls;
        setStarting(false);
      } catch (e) {
        if (cancelled) return;
        logger.error('Camera scan init', e);
        const msg = e instanceof Error ? e.message : 'Kamera başlatılamadı';
        setError(`${msg}. HTTPS gerekli; kamera iznini kontrol et.`);
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        controlsRef.current?.stop();
      } catch {
        // ignore
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Barkod Tara
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3">
          <div className="relative bg-black rounded overflow-hidden aspect-video">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Kamera başlatılıyor…
              </div>
            )}
          </div>
          {error && (
            <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </div>
          )}
          <p className="mt-2 text-[11px] text-gray-500 text-center">
            Barkodu kameraya gösterin. Otomatik okunur. Çalışmıyorsa manuel klavye/HID scanner kullanın.
          </p>
        </div>
      </div>
    </div>
  );
}
