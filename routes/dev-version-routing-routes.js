// routes/dev-version-routing-routes.js
// Beta-only: choose which locations can log in to the beta (canary) app.
// Only functional on the beta server (APP_VERSION=canary + DB refresh script present).
// The DB refresh script dumps m_version_routing before restoring from prod and
// re-loads it afterwards, so changes made here survive the 4-hourly refresh.

const express  = require('express');
const router   = express.Router();
const login    = require('connect-ensure-login');
const security = require('../utils/app-security');
const fs       = require('fs');
const VersionRoutingDao = require('../dao/version-routing-dao');

const isLoginEnsured = login.ensureLoggedIn({});

const REFRESH_SCRIPT_PATH = '/home/ubuntu/refresh_dev_from_s3.sh';

function isBetaEnv() {
    return process.env.APP_VERSION === 'canary' && fs.existsSync(REFRESH_SCRIPT_PATH);
}

function betaOnly(req, res, next) {
    if (!isBetaEnv()) return res.status(404).send('Not available in this environment.');
    next();
}

const guards = [isLoginEnsured, security.isSuperUser(), betaOnly];

// GET /dev-version-routing
router.get('/', guards, async function(req, res, next) {
    try {
        const locations = await VersionRoutingDao.getLocationRouting();
        const audit     = await VersionRoutingDao.getRecentAudit(30);
        res.render('dev-version-routing', {
            title:    'Beta Access (Version Routing)',
            user:     req.user,
            config:   require('../config/app-config').APP_CONFIGS,
            locations,
            audit,
            messages: req.flash()
        });
    } catch (e) {
        next(e);
    }
});

// POST /dev-version-routing/set  { location_code, enabled }
router.post('/set', guards, async function(req, res) {
    const locationCode = (req.body.location_code || '').trim();
    const enabled      = req.body.enabled === true || req.body.enabled === 'true';
    if (!locationCode) return res.status(400).json({ success: false, error: 'location_code required' });

    // Don't let the admin lock their own location out of beta mid-session
    if (!enabled && locationCode === req.user.location_code) {
        return res.status(400).json({ success: false, error: 'Cannot remove beta access for the location you are logged in to.' });
    }

    try {
        const updatedBy = req.user.User_Name || req.user.Person_Name || String(req.user.Person_id);
        const changed = enabled
            ? await VersionRoutingDao.enableCanary(locationCode, updatedBy)
            : await VersionRoutingDao.disableCanary(locationCode, updatedBy);
        res.json({ success: true, changed });
    } catch (e) {
        console.error('Version routing update error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
