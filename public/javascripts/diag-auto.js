// diag-auto.js — silent speed test for a user support has flagged from
// /speedtest/results. Only included in the page while a t_diag_request is active
// for this user (res.locals.diagRequestId). The server decides whether a run is
// due (at most once an hour per request), so this just asks and, if told to,
// runs the light test in the background and saves it. Never shows anything and
// never throws into the page.
(function () {
    const tag = document.currentScript;
    const requestId = tag && parseInt(tag.getAttribute('data-request'), 10);
    if (!requestId || !window.fetch || !window.PMSpeedtest) return;

    // One run at a time across tabs: a short-lived lock in localStorage
    const LOCK_KEY = 'pm_diag_lock';
    const LOCK_MS = 2 * 60 * 1000;
    function takeLock() {
        try {
            const held = parseInt(localStorage.getItem(LOCK_KEY), 10);
            if (held && Date.now() - held < LOCK_MS) return false;
            localStorage.setItem(LOCK_KEY, String(Date.now()));
        } catch (e) { /* storage blocked — the server-side interval still limits runs */ }
        return true;
    }
    function releaseLock() {
        try { localStorage.removeItem(LOCK_KEY); } catch (e) { /* ignore */ }
    }

    async function go() {
        if (document.visibilityState === 'hidden') {
            document.addEventListener('visibilitychange', function onVisible() {
                if (document.visibilityState === 'visible') {
                    document.removeEventListener('visibilitychange', onVisible);
                    go();
                }
            });
            return;
        }
        if (!takeLock()) return;
        try {
            const res = await fetch('/speedtest/auto/check?request=' + requestId + '&t=' + Date.now(),
                { cache: 'no-store', credentials: 'same-origin' });
            const due = await res.json();
            if (!due.run) return;

            const payload = await PMSpeedtest.run({ profile: 'light' });
            payload.request_id = requestId;
            payload.source = 'AUTO';
            await PMSpeedtest.save(payload);
        } catch (e) {
            if (window.DEBUG_LOGGING) console.warn('[diag-auto]', e);
        } finally {
            releaseLock();
        }
    }

    // Let the page finish loading (and its own requests settle) before measuring
    function start() { setTimeout(go, 3000); }
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start);
})();
