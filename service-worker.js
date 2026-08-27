const VERSION = '2.1.8';
const CACHE_NAME = `alo-cozinha-${VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=2.1.8',
  './modules/checklist/styles.css?v=2.1.8',
  './core/module-host.js?v=2.1.8',
  './core/data-contracts.js?v=2.1.8',
  './core/shared-data.js?v=2.1.8',
  './core/api.js?v=2.1.8',
  './core/catalog-sync.js?v=2.1.8',
  './core/ui-dialog.js?v=2.1.8',
  './modules/kds/module.js?v=2.1.8',
  './modules/kds/logic.js?v=2.1.8',
  './modules/kds/storage.js?v=2.1.8',
  './modules/kds/audio.js?v=2.1.8',
  './modules/kds/sync.js?v=2.1.8',
  './modules/kds/app.js?v=2.1.8',
  './modules/checklist/module.js?v=2.1.8',
  './modules/checklist/templates.js?v=2.1.8',
  './modules/checklist/vendor/qrcode.js?v=2.1.8',
  './modules/checklist/app.js?v=2.1.8',
  './modules/compras/module.js?v=2.1.8',
  './modules/compras/host.js?v=2.1.8',
  './modules/l42/module.js?v=2.1.8',
  './modules/l42/host.js?v=2.1.8',
  './assets/sounds/alarme-curto.ogg',
  './assets/sounds/beep-classico.ogg',
  './assets/sounds/sino-forte.ogg',
  './manifest.json',
  './icon.png?v=2.1.8',
  './assets/module-kds.png?v=2.1.8',
  './assets/module-checklist.png?v=2.1.8',
  './assets/module-feira.png?v=2.1.8',
  './modules/compras/index.html',
  './modules/compras/manifest.json',
  './modules/l42/index.html',
  './modules/l42/manifest.json',
  './modules/l42/icon.png?v=2.1.8',
  './modules/l42/service-worker.js',
  './modules/l42/modelo-importacao-produtos-v2.10.xlsx',
  './modules/l42/vendor/html2canvas.min.js',
  './modules/l42/vendor/qrcode.min.js',
  './modules/l42/vendor/html5-qrcode.min.js',
  './modules/l42/vendor/Sortable.min.js',
  './modules/l42/vendor/xlsx.full.min.js'
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
