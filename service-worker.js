const VERSION = '2.1.27';
const CACHE_NAME = `alo-cozinha-${VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=2.1.27',
  './modules/checklist/styles.css?v=2.1.27',
  './core/module-host.js?v=2.1.27',
  './core/data-contracts.js?v=2.1.27',
  './core/shared-data.js?v=2.1.27',
  './core/api.js?v=2.1.27',
  './core/catalog-sync.js?v=2.1.27',
  './core/checklist-sync.js?v=2.1.27',
  './core/ui-dialog.js?v=2.1.27',
  './modules/kds/module.js?v=2.1.27',
  './modules/kds/logic.js?v=2.1.27',
  './modules/kds/storage.js?v=2.1.27',
  './modules/kds/audio.js?v=2.1.27',
  './modules/kds/sync.js?v=2.1.27',
  './modules/kds/app.js?v=2.1.27',
  './modules/checklist/module.js?v=2.1.27',
  './modules/checklist/templates.js?v=2.1.27',
  './modules/checklist/vendor/qrcode.js?v=2.1.27',
  './modules/checklist/app.js?v=2.1.27',
  './modules/checklist/technical-sheets.js?v=2.1.27',
  './modules/checklist/documents.js?v=2.1.27',
  './modules/compras/module.js?v=2.1.27',
  './modules/compras/host.js?v=2.1.27',
  './modules/l42/module.js?v=2.1.27',
  './modules/l42/cloud.js?v=2.1.27',
  './modules/l42/host.js?v=2.1.27',
  './assets/sounds/alarme-curto.ogg',
  './assets/sounds/beep-classico.ogg',
  './assets/sounds/sino-forte.ogg',
  './manifest.json',
  './icon.png?v=2.1.27',
  './assets/module-kds.png?v=2.1.27',
  './assets/module-checklist.png?v=2.1.27',
  './assets/module-feira.png?v=2.1.27',
  './assets/icons/share-2.svg?v=2.1.27',
  './assets/areas/kitchen.svg',
  './assets/areas/kitchen-counter.png',
  './assets/areas/dining-table.png',
  './assets/areas/delivery-rider.png',
  './assets/areas/production.svg',
  './assets/areas/pans.svg',
  './assets/areas/grill.svg',
  './assets/areas/pastry.svg',
  './assets/areas/bar.svg',
  './assets/areas/dining.svg',
  './assets/areas/cleaning.svg',
  './assets/areas/restroom.svg',
  './assets/areas/stock.svg',
  './assets/areas/cold-room.svg',
  './assets/areas/delivery.svg',
  './assets/areas/cashier.svg',
  './modules/compras/index.html',
  './modules/compras/manifest.json',
  './modules/compras/report-send.png?v=2.1.27',
  './modules/compras/clear-completed.png?v=2.1.27',
  './modules/l42/index.html',
  './modules/l42/manifest.json',
  './modules/l42/icon.png?v=2.1.27',
  './modules/l42/assets/qr-reader.svg?v=2.1.27',
  './modules/l42/assets/printer-controls.svg?v=2.1.27',
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
