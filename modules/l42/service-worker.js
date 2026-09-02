const CACHE_NAME = 'alo-l42-v2.1.43-integrado';

self.addEventListener('install', (e) => {
    self.skipWaiting(); // Força a instalação da nova versão imediatamente
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll([
                './',
                './index.html',
                './manifest.json',
                './icon.png',
                './assets/qr-reader.svg?v=2.1.43',
                './assets/printer-controls.svg?v=2.1.43',
                './vendor/html2canvas.min.js',
                './vendor/qrcode.min.js',
                './vendor/html5-qrcode.min.js',
                './vendor/Sortable.min.js',
                './vendor/xlsx.full.min.js',
                './modelo-importacao-produtos-v2.10.xlsx'
            ]);
        })
    );
});

self.addEventListener('activate', (e) => {
    // Apaga as memórias das versões antigas (v1 e v2)
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
});

self.addEventListener('fetch', (e) => {
    // Tenta pegar da internet primeiro (para ver se tem atualização).
    // Se estiver sem internet, puxa do cache offline.
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
