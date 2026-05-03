/**
 * Service worker registration — client-side, idempotent.
 *
 * Önce mevcut tüm SW kayıtlarını ve Cache Storage'ı SİL (eski versiyonların
 * bıraktığı kalıntıları temizle), sonra yeni minimal SW'i kaydet. Bu sayede
 * Faz 1.5'te eklenen agresif asset-cache stratejisinin geride bıraktığı
 * eski CSS hash'lerinden kullanıcılar otomatik kurtulur.
 *
 * Production'da HTTPS gerekli (browser kuralı). Localhost dev'de izinli.
 */

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      // 1) Tüm eski SW kayıtlarını unregister et
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));

      // 2) Cache Storage'da kalan tüm cache'leri sil
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }

      // 3) Şimdi yeni (minimal) SW'i kaydet — pasif fetch handler,
      //    asset cache yok, sadece PWA installability için.
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (err) {
      // Silent fail — SW non-critical
      console.warn('SW (re)register failed', err);
    }
  });
}
