// routes/speedtest-routes.js
// Network speed test for diagnosing "the app is slow" reports.
// The user opens /speedtest, runs the test and reads out the result code;
// support looks it up at /speedtest/results (SuperUser).
// Support can also request a test remotely (t_diag_request): the user's pages
// then include diag-auto.js, which runs a light test silently, at most once an
// hour, until the request expires or is cancelled.
//
// Every response carries a Server-Timing header (see app.js), so the page can
// split each round trip into server time vs network time.

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const login    = require('connect-ensure-login');
const security = require('../utils/app-security');
const SpeedtestDao = require('../dao/client-speedtest-dao');
const diagRequest = require('../utils/diag-request');

const isLoginEnsured = login.ensureLoggedIn({});

// Remote (AUTO) runs: at most one per user per request in this window
const AUTO_INTERVAL_MINUTES = 60;
const REQUEST_HOURS = [4, 24, 72];

// One incompressible buffer, sliced per request. application/octet-stream is not
// compressed by the compression middleware, so bytes on the wire = bytes here.
const MAX_BLOB_BYTES = 4 * 1024 * 1024;
const BLOB = crypto.randomBytes(MAX_BLOB_BYTES);

const noStore = (res) => res.set('Cache-Control', 'no-store, no-cache, must-revalidate');

// Thresholds allow for the India → US-East baseline round trip (~250ms).
function getVerdict({ ping_avg_ms, server_avg_ms, download_mbps, failed_pings, jitter_ms }) {
    const networkMs = (ping_avg_ms || 0) - (server_avg_ms || 0);
    const issues = [];
    let level = 0; // 0 GOOD, 1 FAIR, 2 POOR
    const flag = (lvl, text) => { level = Math.max(level, lvl); issues.push(text); };

    if (failed_pings > 2)              flag(2, 'Connection is dropping requests');
    else if (failed_pings > 0)         flag(1, 'Some requests failed');
    if (networkMs > 800)               flag(2, 'Very high network delay');
    else if (networkMs > 400)          flag(1, 'High network delay');
    if (jitter_ms > 300)               flag(2, 'Very unstable connection');
    else if (jitter_ms > 150)          flag(1, 'Unstable connection');
    if (download_mbps != null) {
        if (download_mbps < 0.7)       flag(2, 'Very slow download speed');
        else if (download_mbps < 2)    flag(1, 'Slow download speed');
    }
    if (server_avg_ms > 300)           flag(1, 'Server was slow to respond');

    return {
        verdict: ['GOOD', 'FAIR', 'POOR'][level],
        message: issues.length ? issues.join('; ') : 'Network looks fine'
    };
}

const toNum = (v, digits) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return digits == null ? Math.round(n) : Number(n.toFixed(digits));
};

// GET /speedtest
router.get('/', isLoginEnsured, function (req, res) {
    res.render('speedtest', {
        title: 'Speed Test',
        user: req.user
    });
});

// GET /speedtest/ping — empty response; the round trip is the measurement
router.get('/ping', isLoginEnsured, function (req, res) {
    noStore(res);
    res.status(204).end();
});

// GET /speedtest/blob?bytes=N — random payload for download measurement
router.get('/blob', isLoginEnsured, function (req, res) {
    const bytes = Math.min(Math.max(parseInt(req.query.bytes, 10) || 0, 1024), MAX_BLOB_BYTES);
    noStore(res);
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Length', String(bytes));
    res.end(BLOB.subarray(0, bytes));
});

// POST /speedtest/upload — body is discarded; the time taken is the measurement
router.post('/upload', isLoginEnsured, express.raw({ type: '*/*', limit: '3mb' }), function (req, res) {
    noStore(res);
    res.status(204).end();
});

// POST /speedtest/result — store the run, return the result code + verdict
router.post('/result', isLoginEnsured, async function (req, res) {
    try {
        const b = req.body || {};
        const metrics = {
            ping_avg_ms:   toNum(b.ping_avg_ms),
            ping_min_ms:   toNum(b.ping_min_ms),
            jitter_ms:     toNum(b.jitter_ms),
            server_avg_ms: toNum(b.server_avg_ms, 1),
            download_mbps: toNum(b.download_mbps, 2),
            upload_mbps:   toNum(b.upload_mbps, 2),
            failed_pings:  toNum(b.failed_pings)
        };
        const { verdict, message } = getVerdict(metrics);

        const details = b.details && typeof b.details === 'object' ? b.details : {};
        details.verdict_message = message;
        let detailsJson = JSON.stringify(details);
        if (detailsJson.length > 60000) detailsJson = JSON.stringify({ truncated: true, verdict_message: message });

        // AUTO runs must belong to an active request that covers this user
        let requestId = null;
        const source = b.source === 'AUTO' ? 'AUTO' : 'MANUAL';
        if (source === 'AUTO') {
            const reqRow = await SpeedtestDao.findApplicableRequest(
                parseInt(b.request_id, 10) || 0, req.user.Person_id, req.user.location_code || null);
            if (!reqRow) return res.status(400).json({ success: false, error: 'No active speed test request.' });
            requestId = reqRow.request_id;
        }

        const id = await SpeedtestDao.create({
            request_id:      requestId,
            source,
            person_id:       req.user.Person_id || null,
            user_name:       req.user.User_Name || null,
            location_code:   req.user.location_code || null,
            ip_address:      req.ip || null,
            user_agent:      (req.headers['user-agent'] || '').substring(0, 500),
            ...metrics,
            connection_type: b.connection_type ? String(b.connection_type).substring(0, 20) : null,
            verdict,
            details_json:    detailsJson
        });

        res.json({ success: true, id, verdict, message });
    } catch (e) {
        console.error('Speed test save error:', e);
        res.status(500).json({ success: false, error: 'Could not save the result.' });
    }
});

// GET /speedtest/auto/check?request= — called by diag-auto.js; says whether a background run is due
router.get('/auto/check', isLoginEnsured, async function (req, res) {
    noStore(res);
    try {
        const requestId = parseInt(req.query.request, 10) || 0;
        const reqRow = await SpeedtestDao.findApplicableRequest(requestId, req.user.Person_id, req.user.location_code || null);
        if (!reqRow) return res.json({ run: false });
        const recent = await SpeedtestDao.hasRecentAutoRun(requestId, req.user.Person_id, AUTO_INTERVAL_MINUTES);
        res.json({ run: !recent });
    } catch (e) {
        console.error('Speed test auto check error:', e);
        res.json({ run: false });
    }
});

// GET /speedtest/results?code=&location=&request=
router.get('/results', [isLoginEnsured, security.isSuperUser()], async function (req, res, next) {
    try {
        const speedtestId  = parseInt(req.query.code, 10) || null;
        const locationCode = (req.query.location || '').trim().toUpperCase() || null;
        const requestId    = parseInt(req.query.request, 10) || null;
        const rows = await SpeedtestDao.findRecent({ speedtestId, locationCode, requestId });
        rows.forEach(r => {
            if (typeof r.details_json === 'string') {
                try { r.details_json = JSON.parse(r.details_json); } catch (e) { /* leave as string */ }
            }
        });
        const requests = await SpeedtestDao.findRecentRequests();
        res.render('speedtest-results', {
            title: 'Speed Test Results',
            user: req.user,
            rows,
            requests,
            requestHours: REQUEST_HOURS,
            autoIntervalMinutes: AUTO_INTERVAL_MINUTES,
            filters: { code: speedtestId || '', location: locationCode || '', request: requestId || '' }
        });
    } catch (e) {
        next(e);
    }
});

// GET /speedtest/users?location= — users for the "request a test" picker
router.get('/users', [isLoginEnsured, security.isSuperUser()], async function (req, res) {
    try {
        const locationCode = (req.query.location || '').trim().toUpperCase();
        if (!locationCode) return res.json({ success: true, users: [] });
        const users = await SpeedtestDao.findUsersForLocation(locationCode);
        res.json({ success: true, users });
    } catch (e) {
        console.error('Speed test users error:', e);
        res.status(500).json({ success: false, error: 'Could not load users.' });
    }
});

// POST /speedtest/requests  { location_code, person_id (blank = all users), hours, note }
router.post('/requests', [isLoginEnsured, security.isSuperUser()], async function (req, res) {
    try {
        const locationCode = (req.body.location_code || '').trim().toUpperCase();
        const personId = parseInt(req.body.person_id, 10) || null;
        const hours = parseInt(req.body.hours, 10);
        if (!locationCode) return res.status(400).json({ success: false, error: 'Location is required.' });
        if (!REQUEST_HOURS.includes(hours)) return res.status(400).json({ success: false, error: 'Invalid duration.' });
        if (personId) {
            const users = await SpeedtestDao.findUsersForLocation(locationCode);
            if (!users.some(u => u.person_id === personId)) {
                return res.status(400).json({ success: false, error: 'That user does not belong to ' + locationCode + '.' });
            }
        }
        const id = await SpeedtestDao.createRequest({
            personId,
            locationCode,
            note: (req.body.note || '').trim().substring(0, 255) || null,
            hours,
            createdBy: req.user.User_Name || String(req.user.Person_id)
        });
        diagRequest.invalidate();
        res.json({ success: true, id });
    } catch (e) {
        console.error('Speed test request create error:', e);
        res.status(500).json({ success: false, error: 'Could not create the request.' });
    }
});

// POST /speedtest/requests/:id/cancel
router.post('/requests/:id/cancel', [isLoginEnsured, security.isSuperUser()], async function (req, res) {
    try {
        await SpeedtestDao.cancelRequest(parseInt(req.params.id, 10) || 0);
        diagRequest.invalidate();
        res.json({ success: true });
    } catch (e) {
        console.error('Speed test request cancel error:', e);
        res.status(500).json({ success: false, error: 'Could not cancel the request.' });
    }
});

module.exports = router;
