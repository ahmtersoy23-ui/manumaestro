/**
 * Minimum service worker — sadece PWA installability + statik asset cache.
 * API çağrıları cache edilmez (stale data riski).
 */

const CACHE_VERSION = 'manumaestro-v1';
const STATIC_ASSETS = ['/', '/dashboard', '/manifest.json', '/icon.svg', '/logo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch(() => {
        // Bazı route'lar offline olabilir; fail silent
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API çağrıları & POST/PATCH/DELETE → asla cache, network'e bırak
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    return; // default network handling
  }

  // Statik assets: cache-first
  if (url.pathname.startsWith('/_next/static/') || url.pathname.match(/\.(svg|png|jpg|jpeg|ico|webp|woff2?)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML sayfaları: network-first, fallback yok (online şart)
  // (offline pick queue Faz 3'te eklenecek)
});
