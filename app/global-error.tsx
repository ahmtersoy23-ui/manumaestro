'use client';

// App Router global error boundary — production'da render hatalarını Sentry'e iletir
// Bu dosya layout.tsx üstü hatalarda devreye girer (segment-level error.tsx yetmediği yerlerde).
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="tr">
      <body className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md text-center px-6 py-10 bg-white border border-gray-200 rounded-lg shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Beklenmeyen bir hata oluştu</h2>
          <p className="text-sm text-gray-600 mb-4">Hata raporlandı. Lütfen sayfayı yenileyin.</p>
          {error.digest && (
            <p className="text-xs text-gray-400 font-mono">Hata kimliği: {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
