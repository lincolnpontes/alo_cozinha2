const VERSION = '2.1.17';
const CACHE_NAME = `alo-cozinha-${VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=2.1.17',
  './modules/checklist/styles.css?v=2.1.17',
  './core/module-host.js?v=2.1.17',
  './core/data-contracts.js?v=2.1.17',
  './core/shared-data.js?v=2.1.17',
  './core/api.js?v=2.1.17',
  './core/catalog-sync.js?v=2.1.17',
  './core/ui-dialog.js?v=2.1.17',
  './modules/kds/module.js?v=2.1.17',
  './modules/kds/logic.js?v=2.1.17',
  './modules/kds/storage.js?v=2.1.17',
  './modules/kds/audio.js?v=2.1.17',
  './modules/kds/sync.js?v=2.1.17',
  './modules/kds/app.js?v=2.1.17',
  './modules/checklist/module.js?v=2.1.17',
  './modules/checklist/templates.js?v=2.1.17',
  './modules/checklist/vendor/qrcode.js?v=2.1.17',
  './modules/checklist/app.js?v=2.1.17',
  './modules/checklist/technical-sheets.js?v=2.1.17',
  './modules/checklist/documents.js?v=2.1.17',
  './modules/compras/module.js?v=2.1.17',
  './modules/compras/host.js?v=2.1.17',
  './modules/l42/module.js?v=2.1.17',
  './modules/l42/cloud.js?v=2.1.17',
  './modules/l42/host.js?v=2.1.17',
  './assets/sounds/alarme-curto.ogg',
  './assets/sounds/beep-classico.ogg',
  './assets/sounds/sino-forte.ogg',
  './manifest.json',
  './icon.png?v=2.1.17',
  './assets/module-kds.png?v=2.1.17',
  './assets/module-checklist.png?v=2.1.17',
  './assets/module-feira.png?v=2.1.17',
  './modules/compras/index.html',
  './modules/compras/manifest.json',
  './modules/l42/index.html',
  './modules/l42/manifest.json',
  './modules/l42/icon.png?v=2.1.17',
  './modules/l42/assets/qr-reader.svg?v=2.1.17',
  './modules/l42/assets/printer-controls.svg?v=2.1.17',
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
