// routes/dev-db-refresh-routes.js
// Dev-only: control the 4-hourly DB refresh from S3.
// Only functional when /home/ubuntu/refresh_dev_from_s3.sh exists on the server.

const express  = require('express');
const router   = express.Router();
const login    = require('connect-ensure-login');
const security = require('../utils/app-security');
const db       = require('../db/db-connection');
const fs       = require('fs');
const { exec, execFile } = require('child_process');

const isLoginEnsured = login.ensureLoggedIn({});

const SCRIPT_PATH = '/home/ubuntu/refresh_dev_from_s3.sh';
const PAUSE_FILE   = '/home/ubuntu/.dev_refresh_paused';
const LOG_FILE     = '/home/ubuntu/logs/dev_refresh_s3.log';

function isDevEnv() {
    return fs.existsSync(SCRIPT_PATH);
}

// GET /dev-db-refresh
router.get('/', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    if (!isDevEnv()) {
        return res.status(404).send('Not available in this environment.');
    }

    let lastRefresh = null;
    try {
        const rows = await db.sequelize.query(
            `SELECT backup_filename, backup_taken_at, restored_at, s3_location
             FROM _dev_backup_info ORDER BY restored_at DESC LIMIT 1`,
            { type: db.Sequelize.QueryTypes.SELECT }
        );
        lastRefresh = rows[0] || null;
    } catch (e) { /* table may not exist yet */ }

    const isPaused  = fs.existsSync(PAUSE_FILE);
    const isRunning = await checkRunning();

    let logTail = '';
    try {
        const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
        logTail = lines.slice(-50).join('\n');
    } catch (e) { /* log not yet created */ }

    res.render('dev-db-refresh', {
        title:       'Dev DB Refresh Control',
        user:        req.user,
        config:      require('../config/app-config').APP_CONFIGS,
        lastRefresh,
        isPaused,
        isRunning,
        logTail,
        messages:    req.flash()
    });
});

// POST /dev-db-refresh/pause
router.post('/pause', [isLoginEnsured, security.isAdmin()], function(req, res) {
    if (!isDevEnv()) return res.status(404).json({ error: 'Not available' });
    try {
        fs.writeFileSync(PAUSE_FILE, new Date().toISOString());
        res.json({ success: true, paused: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /dev-db-refresh/resume
router.post('/resume', [isLoginEnsured, security.isAdmin()], function(req, res) {
    if (!isDevEnv()) return res.status(404).json({ error: 'Not available' });
    try {
        if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE);
        res.json({ success: true, paused: false });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /dev-db-refresh/run-now
// Spawns the refresh script in the background and returns immediately.
// WARNING: drops and recreates the dev DB — app DB connections will blip.
router.post('/run-now', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    if (!isDevEnv()) return res.status(404).json({ error: 'Not available' });

    const running = await checkRunning();
    if (running) return res.status(409).json({ error: 'Refresh is already running' });

    if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE);

    exec(`bash ${SCRIPT_PATH} >> ${LOG_FILE} 2>&1 &`, (err) => {
        if (err) console.error('Dev refresh spawn error:', err);
    });

    res.json({ success: true, message: 'Refresh started in background' });
});

// GET /dev-db-refresh/status — AJAX poll
router.get('/status', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    if (!isDevEnv()) return res.json({ available: false });

    let lastRefresh = null;
    try {
        const rows = await db.sequelize.query(
            `SELECT backup_filename, backup_taken_at, restored_at FROM _dev_backup_info ORDER BY restored_at DESC LIMIT 1`,
            { type: db.Sequelize.QueryTypes.SELECT }
        );
        lastRefresh = rows[0] || null;
    } catch (e) { /* ok */ }

    const isPaused  = fs.existsSync(PAUSE_FILE);
    const isRunning = await checkRunning();

    let logTail = '';
    try {
        const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
        logTail = lines.filter(l => l.trim()).slice(-30).join('\n');
    } catch (e) { /* ok */ }

    res.json({ available: true, isPaused, isRunning, lastRefresh, logTail });
});

function checkRunning() {
    return new Promise((resolve) => {
        // Use -x with bash to match only actual bash processes running the script,
        // excluding pgrep itself and the node process checking for it.
        exec("pgrep -f 'bash.*refresh_dev_from_s3\\.sh'", (err, stdout) => {
            resolve(!!stdout.trim());
        });
    });
}

module.exports = router;
