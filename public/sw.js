// Service worker for the installable app (PWA).
// Every page still comes from the server. Kept on the phone: the offline page,
// shown when a page can't load because there's no internet, and the density
// calculator (works without signal at the decanting bay; refreshed on every
// online visit). Bump CACHE_NAME whenever offline.html changes.
const CACHE_NAME = 'petromath-offline-v2';
const OFFLINE_URL = '/offline.html';
const DENSITY_URL = '/density';

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function (cache) { return cache.addAll([OFFLINE_URL, DENSITY_URL, '/images/app-icons/icon-192.png', '/images/mc_logo.jpg']); })
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
    // The density page's logo is the one image kept for offline use.
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/images/mc_logo.jpg') {
        event.respondWith(fetch(req).catch(function () { return caches.match('/images/mc_logo.jpg'); }));
        return;
    }
    if (req.method !== 'GET' || req.mode !== 'navigate') return;

    const isDensity = url.pathname === DENSITY_URL;
    event.respondWith((async function () {
        try {
            const preloaded = await event.preloadResponse;
            const res = preloaded || await fetch(req);
            if (isDensity && res.ok) {
                const copy = res.clone();
                caches.open(CACHE_NAME).then(function (c) { return c.put(DENSITY_URL, copy); });
            }
            return res;
        } catch (err) {
            if (isDensity) {
                const saved = await caches.match(DENSITY_URL);
                if (saved) return saved;
            }
            const offline = await caches.match(OFFLINE_URL);
            return offline || Response.error();
        }
    })());
});

// Deadline reminders (services/deadline-reminder-scheduler.js). Payload JSON:
// { title, body, url, tag }. Same tag replaces the earlier notification.
self.addEventListener('push', function (event) {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
    event.waitUntil(self.registration.showNotification(data.title || 'PetroMath', {
        body: data.body || '',
        tag: data.tag || undefined,
        renotify: !!data.tag,
        icon: '/images/app-icons/icon-192.png',
        data: { url: data.url || '/deadline' }
    }));
});

// Tap: reuse an open app window if there is one, else open a new one
self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    const target = new URL((event.notification.data && event.notification.data.url) || '/deadline', self.location.origin).href;
    event.waitUntil((async function () {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const w of wins) {
            if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
                await w.focus();
                if ('navigate' in w) return w.navigate(target);
                return;
            }
        }
        return self.clients.openWindow(target);
    })());
});
