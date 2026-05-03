/**
 * Minimal service worker — yalnızca PWA installability için.
 *
 * NOT (2026-05-03): Statik asset cache stratejisi kaldırıldı çünkü
 * deploy sonrası eski CSS hash'leri tutarak kararsız stil davranışına
 * sebep oluyordu. Next.js zaten /_next/static/ için immutable
 * Cache-Control header gönderiyor — browser kendi HTTP cache'i ile
 * doğru hash invalidation yapıyor. SW'in araya girmesi gereksiz.
 *
 * Önceki tüm cache'ler activate sırasında temizlenir (mevcut
 * kullanıcılarda eski cache otomatik silinsin).
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pasif fetch handler — bazı browser'lar PWA installable kabul etmek
// için bir fetch listener'ın varlığını arar. Kayıt yapıyoruz ama
// tüm istekleri network'e bırakıyoruz.
self.addEventListener('fetch', () => {
  // pass-through
});
