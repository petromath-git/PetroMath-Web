// services/oil-portal-health-scheduler.js
//
// Checks every morning that the IOCL e-Mitra portal still looks the way the statement pull expects,
// WITHOUT logging in (so it uses none of a dealer's daily IOCL logins). While the portal is not OK it
// re-checks every hour, so a fix (ours or IOCL's) is picked up without waiting a day.
//   OK          -> pull allowed
//   UNREACHABLE -> pull allowed, users warned (usually maintenance)
//   CHANGED     -> pull refused until a later check passes; users told to upload the Excel instead
// Only runs while IOCL_PORTAL_PULL_ENABLED is 'Y' for at least one location.
//
const cron = require('node-cron');
const credentialDao = require('../dao/oil-portal-credential-dao');
const ioclPortal = require('./iocl-portal-service');

const PORTAL_IOCL = 'IOCL_EMITRA';
const DAILY_CRON = '0 6 * * *';       // 06:00 (server runs in IST)
const RETRY_CRON = '20 * * * *';      // hourly, only while the last result wasn't OK
const STALE_MINUTES = 20 * 60;        // boot-time check if the last one is older than this

let running = null;

async function runCheck(trigger) {
    if (running) return running;      // never two checks at once
    running = (async () => {
        try {
            if (!(await credentialDao.isPortalPullEnabledAnywhere())) {
                return null;
            }
            const result = await ioclPortal.checkHealth();
            await credentialDao.savePortalHealth(PORTAL_IOCL, result.status, result.detail);
            console.log(`OilPortalHealth: IOCL ${result.status} (${trigger}) - ${result.detail}`);
            return result;
        } catch (err) {
            console.error('OilPortalHealth: check failed:', err.message);
            return null;
        } finally {
            running = null;
        }
    })();
    return running;
}

function start() {
    cron.schedule(DAILY_CRON, () => runCheck('DAILY'));
    cron.schedule(RETRY_CRON, async () => {
        const h = await credentialDao.getPortalHealth(PORTAL_IOCL).catch(() => null);
        if (h && h.status !== 'OK') runCheck('RETRY');
    });

    // After a restart, check once if we have no recent result (let the app settle first)
    setTimeout(async () => {
        const h = await credentialDao.getPortalHealth(PORTAL_IOCL).catch(() => null);
        if (!h || h.minutes_since_check === null || Number(h.minutes_since_check) > STALE_MINUTES) runCheck('STARTUP');
    }, 60 * 1000);
}

module.exports = { start, runCheck, PORTAL_IOCL };
