const CACHE_NAME = 'alo-feira-v2.1.17-r1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './src/assets/icon-192.png',
  './src/assets/icon-512.png',
  './src/styles/base.css?v=2.1.17-compras-r1',
  './src/styles/layout.css?v=2.1.17-compras-r1',
  './src/styles/components.css?v=2.1.17-compras-r1',
  './src/styles/features.css?v=2.1.17-compras-r1',
  './src/styles/responsive.css?v=2.1.17-compras-r1',
  './src/scripts/domain.js?v=2.1.17-compras-r1',
  './src/scripts/core.js?v=2.1.17-compras-r1',
  './src/scripts/security.js?v=2.1.17-compras-r1',
  './src/scripts/sync.js?v=2.1.17-compras-r1',
  './src/scripts/auth.js?v=2.1.17-compras-r1',
  './src/scripts/orders.js?v=2.1.17-compras-r1',
  './src/scripts/catalog.js?v=2.1.17-compras-r1',
  './src/scripts/drafts.js?v=2.1.17-compras-r1',
  './src/scripts/purchases.js?v=2.1.17-compras-r1',
  './src/scripts/purchase-details.js?v=2.1.17-compras-r1',
  './src/scripts/reports.js?v=2.1.17-compras-r1',
  './src/scripts/settings.js?v=2.1.17-compras-r1',
  './src/scripts/catalog-settings.js?v=2.1.17-compras-r1',
  './src/scripts/people-settings.js?v=2.1.17-compras-r1',
  './src/scripts/app.js?v=2.1.17-compras-r1'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('alo-feira-') && key !== CACHE_NAME).map(key => caches.delete(key))))
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
