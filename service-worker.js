const VERSION = '2.1.48';
const CACHE_NAME = `alo-cozinha2-${VERSION}-turnstile`;
const CACHE_PREFIX = 'alo-cozinha2-';
const APP_SHELL = [
  './',
  './index.html',
  './auth-callback.html',
  './styles.css?v=2.1.48',
  './modules/checklist/styles.css?v=2.1.48',
  './core/storage-scope.js?v=2.1.48',
  './core/demo.js?v=2.1.48',
  './core/module-host.js?v=2.1.48',
  './core/data-contracts.js?v=2.1.48',
  './core/shared-data.js?v=2.1.48',
  './vendor/supabase.min.js?v=2.1.48',
  './core/cloud.js?v=2.1.48',
  './core/api.js?v=2.1.48',
  './core/catalog-sync.js?v=2.1.48',
  './core/checklist-sync.js?v=2.1.48',
  './core/ui-dialog.js?v=2.1.48',
  './modules/kds/module.js?v=2.1.48',
  './modules/kds/logic.js?v=2.1.48',
  './modules/kds/storage.js?v=2.1.48',
  './modules/kds/audio.js?v=2.1.48',
  './modules/kds/sync.js?v=2.1.48',
  './modules/kds/app.js?v=2.1.48',
  './modules/checklist/module.js?v=2.1.48',
  './modules/checklist/templates.js?v=2.1.48',
  './modules/checklist/vendor/qrcode.js?v=2.1.48',
  './modules/checklist/app.js?v=2.1.48',
  './modules/checklist/technical-sheets.js?v=2.1.48',
  './modules/checklist/documents.js?v=2.1.48',
  './modules/compras/module.js?v=2.1.48',
  './modules/compras/host.js?v=2.1.48',
  './modules/l42/module.js?v=2.1.48',
  './modules/l42/cloud.js?v=2.1.48',
  './modules/l42/host.js?v=2.1.48',
  './assets/sounds/alarme-curto.ogg',
  './assets/sounds/beep-classico.ogg',
  './assets/sounds/sino-forte.ogg',
  './manifest.json',
  './icon.png?v=2.1.48',
  './assets/module-kds.png?v=2.1.48',
  './assets/module-checklist.png?v=2.1.48',
  './assets/module-feira.png?v=2.1.48',
  './assets/module-settings.png?v=2.1.48',
  './assets/settings/restaurant-data.svg?v=2.1.48',
  './assets/settings/restaurant-sectors.svg?v=2.1.48',
  './assets/settings/home-modules.svg?v=2.1.48',
  './assets/settings/employees-access.svg?v=2.1.48',
  './assets/icons/share-2.svg?v=2.1.48',
  './assets/demo/alvara-sanitario-ficticio.png?v=2.1.48',
  './assets/demo/contrato-social-ficticio.png?v=2.1.48',
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
  './modules/compras/report-send.png?v=2.1.48',
  './modules/compras/clear-completed.png?v=2.1.48',
  './modules/l42/index.html',
  './modules/l42/manifest.json',
  './modules/l42/icon.png?v=2.1.48',
  './modules/l42/assets/qr-reader.svg?v=2.1.48',
  './modules/l42/assets/printer-controls.svg?v=2.1.48',
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
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
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
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return cache.match('./index.html');
        throw new Error('Recurso indisponível offline.');
      })
  );
});
