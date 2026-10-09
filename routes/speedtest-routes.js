// routes/speedtest-routes.js
// Network speed test for diagnosing "the app is slow" reports.
// The user opens /speedtest, runs the test and reads out the result code;
// support looks it up at /speedtest/results (SuperUser).
//
// Every response carries a Server-Timing header (see app.js), so the page can
// split each round trip into server time vs network time.

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const login    = require('connect-ensure-login');
const security = require('../utils/app-security');
const SpeedtestDao = require('../dao/client-speedtest-dao');

const isLoginEnsured = login.ensureLoggedIn({});

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

        const id = await SpeedtestDao.create({
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

// GET /speedtest/results?code=&location=
router.get('/results', [isLoginEnsured, security.isSuperUser()], async function (req, res, next) {
    try {
        const speedtestId  = parseInt(req.query.code, 10) || null;
        const locationCode = (req.query.location || '').trim().toUpperCase() || null;
        const rows = await SpeedtestDao.findRecent({ speedtestId, locationCode });
        rows.forEach(r => {
            if (typeof r.details_json === 'string') {
                try { r.details_json = JSON.parse(r.details_json); } catch (e) { /* leave as string */ }
            }
        });
        res.render('speedtest-results', {
            title: 'Speed Test Results',
            user: req.user,
            rows,
            filters: { code: speedtestId || '', location: locationCode || '' }
        });
    } catch (e) {
        next(e);
    }
});

module.exports = router;
