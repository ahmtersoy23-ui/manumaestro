// Sentry client (browser) initialization
// NEXT_PUBLIC_SENTRY_DSN yoksa no-op.
import * as Sentry from '@sentry/nextjs';

// Mobil tarayıcı capability hatalarını yut — bunlar bizim için aksiyonable değil
// ve native BarcodeDetector / ImageCapture API'lerinde cihaz bazlı oluşur.
const IGNORED_ERROR_PATTERNS = [
  /setPhotoOptions failed/i,
  /takePhoto\b.*not supported/i,
];

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV || process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false })],
    release: process.env.NEXT_PUBLIC_APP_VERSION,
    beforeSend(event, hint) {
      const err = hint?.originalException;
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : event.message ?? '';
      if (msg && IGNORED_ERROR_PATTERNS.some((re) => re.test(msg))) {
        return null;
      }
      return event;
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
