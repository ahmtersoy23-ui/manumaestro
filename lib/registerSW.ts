/**
 * Service worker registration — client-side, idempotent.
 * Production'da HTTPS gerekli (browser kuralı). Localhost dev'de izinli.
 */

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  // Manumaestro her zaman authenticated; SW only enable for performance + install
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        // Silent fail — SW non-critical
        console.warn('SW register failed', err);
      });
  });
}
