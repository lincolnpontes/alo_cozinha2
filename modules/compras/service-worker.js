const CACHE_NAME = 'alo-cozinha2-compras-v2.1.48-r2';
const CACHE_PREFIX = 'alo-cozinha2-compras-';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './report-send.png?v=2.1.48',
  './clear-completed.png?v=2.1.48',
  './src/assets/icon-192.png',
  './src/assets/icon-512.png',
  './src/styles/base.css?v=2.1.48-compras-r2',
  './src/styles/layout.css?v=2.1.48-compras-r2',
  './src/styles/components.css?v=2.1.48-compras-r2',
  './src/styles/features.css?v=2.1.48-compras-r2',
  './src/styles/responsive.css?v=2.1.48-compras-r2',
  './src/scripts/domain.js?v=2.1.48-compras-r2',
  './src/scripts/core.js?v=2.1.48-compras-r2',
  './src/scripts/security.js?v=2.1.48-compras-r2',
  './src/scripts/sync.js?v=2.1.48-compras-r2',
  './src/scripts/auth.js?v=2.1.48-compras-r2',
  './src/scripts/orders.js?v=2.1.48-compras-r2',
  './src/scripts/catalog.js?v=2.1.48-compras-r2',
  './src/scripts/drafts.js?v=2.1.48-compras-r2',
  './src/scripts/purchases.js?v=2.1.48-compras-r2',
  './src/scripts/purchase-details.js?v=2.1.48-compras-r2',
  './src/scripts/reports.js?v=2.1.48-compras-r2',
  './src/scripts/settings.js?v=2.1.48-compras-r2',
  './src/scripts/catalog-settings.js?v=2.1.48-compras-r2',
  './src/scripts/people-settings.js?v=2.1.48-compras-r2',
  './src/scripts/app.js?v=2.1.48-compras-r2'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if(request.method !== 'GET' || url.origin !== self.location.origin) return;

  if(request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const update = fetch(request)
        .then(response => {
          if(response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => cached);
      return cached || update;
    })
  );
});
