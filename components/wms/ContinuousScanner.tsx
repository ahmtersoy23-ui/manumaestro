'use client';

/**
 * Sürekli (persistent) barkod tarayıcı — fullscreen modal.
 *
 * ScanInput tek okumalı (modal okur+kapanır); bu component üst üste tarama için
 * açık kalır. Her okumada:
 *  - 1.5 sn cooldown (aynı kod tekrar tetiklenmez)
 *  - Web Audio API beep
 *  - navigator.vibrate(50)
 *  - Yeşil/kırmızı flash overlay
 *
 * Cihaz: mobilde arka kamera otomatik seçilir. Torch (varsa) toggle edilebilir.
 *
 * Kullanım:
 *   <ContinuousScanner
 *     open={open}
 *     onScan={(code) => ...}   // her başarılı okumada
 *     onClose={() => ...}
 *     status={lastStatus}      // 'ok' | 'err' | null — feedback rengi
 *     hint="Ürünü kameraya gösterin"
 *   />
 */

import { useEffect, useRef, useState } from 'react';
import { Camera, X, Flashlight, Loader2 } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ContinuousScanner');

interface Props {
  open: boolean;
  onScan: (code: string) => void;
  onClose: () => void;
  /** Son okumanın UI feedback'i için status (ok=yeşil flash, err=kırmızı) */
  status?: 'ok' | 'err' | null;
  /** Üstte gösterilecek kısa açıklama */
  hint?: string;
  /** Cooldown süresi (ms). Default 1500 */
  cooldownMs?: number;
}

export function ContinuousScanner({
  open,
  onScan,
  onClose,
  status,
  hint,
  cooldownMs = 1500,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [flash, setFlash] = useState<'ok' | 'err' | null>(null);

  // Beep feedback (Web Audio API — kütüphane yok)
  const beep = (kind: 'ok' | 'err' = 'ok') => {
    try {
      type AudioCtor = typeof AudioContext;
      const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = kind === 'ok' ? 1100 : 300;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      // ignore
    }
  };

  // Flash overlay: dışarıdan gelen status değişiminde tetiklenir
  useEffect(() => {
    if (!status) return;
    setFlash(status);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(status === 'ok' ? 50 : [40, 60, 40]);
    }
    beep(status);
    const t = setTimeout(() => setFlash(null), 250);
    return () => clearTimeout(t);
  }, [status]);

  // Kamera başlat
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setStarting(true);

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();

        // Mevcut kameralardan arka kamera tercih et
        let deviceId: string | undefined = undefined;
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const cameras = devices.filter((d) => d.kind === 'videoinput');
          const back = cameras.find((c) => /back|rear|environment|arka/i.test(c.label));
          deviceId = back?.deviceId ?? cameras[0]?.deviceId;
        } catch {
          // ignore — undefined ile default kameraya bırak
        }

        if (cancelled) return;
        const videoEl = videoRef.current;
        if (!videoEl) return;

        const controls = await reader.decodeFromVideoDevice(deviceId, videoEl, (result) => {
          if (cancelled || !result) return;
          const text = result.getText().trim();
          if (!text) return;

          const now = Date.now();
          const last = lastScanRef.current;
          if (last && last.code === text && now - last.at < cooldownMs) return;
          lastScanRef.current = { code: text, at: now };
          onScan(text);
        });
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;

        // Track referansı + torch desteğini tespit et
        const stream = videoEl.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        try {
          const caps = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
          setTorchSupported(!!caps?.torch);
        } catch {
          setTorchSupported(false);
        }

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
      controlsRef.current = null;
      trackRef.current = null;
      setTorchOn(false);
    };
  }, [open, onScan, cooldownMs]);

  // Torch toggle
  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track || !torchSupported) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet & { torch: boolean }],
      });
      setTorchOn((v) => !v);
    } catch (e) {
      logger.error('Torch toggle', e);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Camera className="w-4 h-4" />
          Sürekli Tarama
        </h2>
        <div className="flex items-center gap-2">
          {torchSupported && (
            <button
              onClick={toggleTorch}
              className={`p-2 rounded ${torchOn ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-white'}`}
              title="Flaş"
            >
              <Flashlight className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded bg-gray-700 hover:bg-gray-600"
            title="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
        />

        {/* Hedef çerçevesi */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-64 h-40 border-2 border-white/70 rounded-lg shadow-lg" />
        </div>

        {/* Flash overlay (ok/err) */}
        {flash && (
          <div
            className={`pointer-events-none absolute inset-0 ${
              flash === 'ok' ? 'bg-green-500/35' : 'bg-red-500/45'
            }`}
          />
        )}

        {starting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Kamera başlatılıyor…
          </div>
        )}

        {error && (
          <div className="absolute bottom-4 left-4 right-4 bg-red-700 text-white text-xs rounded p-2">
            {error}
          </div>
        )}

        {hint && !starting && !error && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs rounded px-3 py-1.5">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
