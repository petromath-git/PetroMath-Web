// utils/request-cache.js
// Small in-process TTL cache for lookups that run on every request (session
// check, location switcher, per-location UI settings). Without it each page and
// AJAX call pays several DB round trips before reaching its handler.
//
// Stores the in-flight promise, so concurrent requests share one query; a
// failed load is dropped so the next request retries. Single PM2 process, so
// invalidate() here is enough to make a change visible immediately; otherwise
// entries simply expire after their TTL.

const store = new Map(); // key → { value: Promise, expires: ms }
const MAX_ENTRIES = 5000;

function sweep(now) {
    for (const [key, entry] of store) {
        if (entry.expires <= now) store.delete(key);
    }
}

function getOrLoad(key, ttlMs, loader) {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.expires > now) return hit.value;

    if (store.size >= MAX_ENTRIES) sweep(now);
    const value = Promise.resolve().then(loader);
    const entry = { value, expires: now + ttlMs };
    store.set(key, entry);
    value.catch(() => {
        if (store.get(key) === entry) store.delete(key);
    });
    return value;
}

// Drop every key starting with prefix (or everything when no prefix)
function invalidate(prefix) {
    for (const key of store.keys()) {
        if (!prefix || key.startsWith(prefix)) store.delete(key);
    }
}

module.exports = { getOrLoad, invalidate };
