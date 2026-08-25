const VERSION = '2.1.1';
const CACHE_NAME = `alo-cozinha-${VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=2.1.1',
  './tasks.css?v=2.1.1',
  './logic.js?v=2.1.1',
  './storage.js?v=2.1.1',
  './api.js?v=2.1.1',
  './audio.js?v=2.1.1',
  './sync.js?v=2.1.1',
  './catalog-sync.js?v=2.1.1',
  './ui.js?v=2.1.1',
  './task-templates.js?v=2.1.1',
  './vendor/qrcode.js?v=2.1.1',
  './feira-module.js?v=2.1.1',
  './tasks.js?v=2.1.1',
  './app.js?v=2.1.1',
  './assets/sounds/alarme-curto.ogg',
  './assets/sounds/beep-classico.ogg',
  './assets/sounds/sino-forte.ogg',
  './manifest.json',
  './icon.png?v=2.1.1',
  './assets/module-kds.png?v=2.1.1',
  './assets/module-checklist.png?v=2.1.1',
  './assets/module-feira.png?v=2.1.1',
  './modules/alo-feira/index.html',
  './modules/alo-feira/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('Recurso indisponível offline.');
      })
  );
});
