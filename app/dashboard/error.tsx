'use client';

/**
 * Dashboard scoped error boundary.
 * Bir server component (örn. pricelab_db'ye giden Etiket sayfası) ya da
 * render hatası tüm uygulamayı global-error'a düşürmesin — sayfa-içi
 * kurtarılabilir hata ekranı + Sentry raporu.
 */

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-4">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900">Bu sayfa yüklenemedi</h2>
      <p className="text-sm text-gray-500 mt-1 max-w-md">
        Geçici bir hata oluştu (veri kaynağı yanıt vermemiş olabilir). Tekrar deneyin;
        sorun sürerse yöneticiye bildirin.
      </p>
      {error.digest && <p className="text-xs text-gray-400 mt-2 font-mono">#{error.digest}</p>}
      <Button onClick={reset} icon={<RefreshCw className="w-4 h-4" />} className="mt-5">
        Tekrar Dene
      </Button>
    </div>
  );
}
