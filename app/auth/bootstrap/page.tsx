'use client';

/**
 * Auth bootstrap — SSO portal'ın token'ı URL fragment ile yolladığı akışı işler.
 *
 * Akış:
 *   1. Portal redirect: https://manumaestro.../auth/bootstrap#token=eyJ...
 *   2. Client (bu sayfa): window.location.hash'tan token'ı al
 *   3. POST /api/auth/login → cookie set
 *   4. Hash temizle + /dashboard'a redirect
 *
 * Niye fragment?
 *   - Tarayıcı `#xxx` kısmını HTTP isteğinde server'a göndermez
 *   - nginx/Cloudflare access log'una düşmez
 *   - Referer header'da paylaşılmaz (fragment Referer'a dahil edilmez)
 *   - Sadece browser history'sinde tek bir kez kalır (ondan da temizleriz)
 */

import { useEffect, useState } from 'react';

export default function AuthBootstrapPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ssoUrl = process.env.NEXT_PUBLIC_SSO_URL || 'https://apps.iwa.web.tr';

    const run = async () => {
      // URL fragment'ı oku: "#token=xxx" veya "#token=xxx&next=/path"
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash);
      const token = params.get('token');
      const next = params.get('next') || '/dashboard';

      if (!token) {
        if (!cancelled) setError('Token bulunamadı. Yeniden giriş yapın.');
        setTimeout(() => window.location.replace(ssoUrl), 1500);
        return;
      }

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          if (!cancelled) setError('Token geçersiz veya süresi dolmuş.');
          setTimeout(() => window.location.replace(ssoUrl), 1500);
          return;
        }
        // Cookie set oldu — hash'i ve sayfayı temizle, hedefe git
        if (!cancelled) window.location.replace(next);
      } catch {
        if (!cancelled) setError('Auth servisine ulaşılamadı.');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center px-6">
        {error ? (
          <>
            <h2 className="text-lg font-semibold text-red-600 mb-1">Giriş başarısız</h2>
            <p className="text-sm text-gray-500">{error}</p>
          </>
        ) : (
          <>
            <div className="inline-block w-8 h-8 border-3 border-gray-200 border-t-purple-600 rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-500">Giriş yapılıyor…</p>
          </>
        )}
      </div>
    </div>
  );
}
