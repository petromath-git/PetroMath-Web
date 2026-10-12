// Service worker for the installable app (PWA).
// Every page still comes from the server. The only thing kept on the phone is
// the offline page, shown when a page can't load because there's no internet.
// Bump CACHE_NAME whenever offline.html changes.
const CACHE_NAME = 'petromath-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function (cache) { return cache.addAll([OFFLINE_URL, '/images/app-icons/icon-192.png']); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil((async function () {
        // Start the page request while the worker boots, so it adds no delay
        if (self.registration.navigationPreload) {
            await self.registration.navigationPreload.enable();
        }
        const keys = await caches.keys();
        await Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); }));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', function (event) {
    const req = event.request;
    // Only page loads. Form posts, uploads, AJAX, scripts and images go
    // straight to the network as if there were no service worker.
    if (req.method !== 'GET' || req.mode !== 'navigate') return;

    event.respondWith((async function () {
        try {
            const preloaded = await event.preloadResponse;
            if (preloaded) return preloaded;
            return await fetch(req);
        } catch (err) {
            const offline = await caches.match(OFFLINE_URL);
            return offline || Response.error();
        }
    })());
});
