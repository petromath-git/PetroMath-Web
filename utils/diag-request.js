// utils/diag-request.js
// Sets res.locals.diagRequestId when support has asked for a remote speed test
// for this user (t_diag_request, created from /speedtest/results). The layout
// then includes diag-auto.js, which runs the test silently in the background.
// Looked up at most once a minute per user; cleared when a request is created
// or cancelled so it takes effect on the user's next page load.

const SpeedtestDao = require('../dao/client-speedtest-dao');

const CACHE_MS = 60_000;
const _cache = new Map(); // `${person_id}|${location_code}` → { requestId, at }

function invalidate() {
    _cache.clear();
}

async function diagRequestMiddleware(req, res, next) {
    res.locals.diagRequestId = null;
    const user = req.user;
    if (!user || !user.Person_id || req.method !== 'GET') return next();

    const key = user.Person_id + '|' + (user.location_code || '');
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
        res.locals.diagRequestId = hit.requestId;
        return next();
    }
    try {
        const requestId = await SpeedtestDao.findActiveRequestForUser(user.Person_id, user.location_code || null);
        _cache.set(key, { requestId, at: Date.now() });
        res.locals.diagRequestId = requestId;
    } catch (e) {
        // Table missing / DB hiccup — never block the page over diagnostics
        _cache.set(key, { requestId: null, at: Date.now() });
    }
    next();
}

module.exports = { diagRequestMiddleware, invalidate };
