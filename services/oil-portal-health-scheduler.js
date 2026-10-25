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
// Invoice auto-import (from 06:10, after the health check): for each location with a saved IOCL login,
// one login to fetch the last week's invoices and save the ones not yet entered. Accounts go ONE AT A
// TIME, at least 5 minutes apart, in a fixed order (new locations join the end), so this server never
// sends IOCL a burst of logins: at most 12 an hour however many locations use it. Runs only while the
// health check is OK, and never retries an account the same day (one automatic login per account).
//
const cron = require('node-cron');
const credentialDao = require('../dao/oil-portal-credential-dao');
const ioclPortal = require('./iocl-portal-service');

const PORTAL_IOCL = 'IOCL_EMITRA';
const DAILY_CRON = '0 6 * * *';       // 06:00 (server runs in IST)
const RETRY_CRON = '20 * * * *';      // hourly, only while the last result wasn't OK
const STALE_MINUTES = 20 * 60;        // boot-time check if the last one is older than this
const INVOICE_CRON = '10 6 * * *';    // 06:10 IST, after the health check
const INVOICE_GAP_MS = 5 * 60 * 1000; // between two accounts' logins (plus up to 1 min random)
const INVOICE_START_MIN_IST = 6 * 60 + 10;
const INVOICE_END_HOUR_IST = 21;      // no automatic logins after 21:00

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function istMinutesNow() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return now.getHours() * 60 + now.getMinutes();
}

let invoiceRun = null;

async function runInvoiceImports(trigger) {
    if (invoiceRun) return invoiceRun;   // never two runs at once
    invoiceRun = (async () => {
        const tried = new Set();
        let lastLoginAt = 0;
        try {
            if (!(await credentialDao.isPortalPullEnabledAnywhere())) return;
            // required here: the controller itself requires this module
            const accounts = require('../controllers/oil-company-account-controller');
            for (;;) {
                // re-read each round so an account added during the run joins the end of the queue
                const next = (await credentialDao.listAutoInvoiceAccounts(PORTAL_IOCL)).find(a => !tried.has(a.bank_id));
                if (!next) break;
                tried.add(next.bank_id);

                const wait = lastLoginAt ? lastLoginAt + INVOICE_GAP_MS + Math.floor(Math.random() * 60 * 1000) - Date.now() : 0;
                if (wait > 0) await sleep(wait);
                if (istMinutesNow() >= INVOICE_END_HOUR_IST * 60) break;
                const h = await credentialDao.getPortalHealth(PORTAL_IOCL).catch(() => null);
                if (!h || h.status !== 'OK') {
                    console.log(`OilPortalInvoices: stopped (${trigger}) - portal health is ${h ? h.status : 'unknown'}`);
                    break;
                }

                try {
                    const r = await accounts.autoImportIoclInvoices(next.location_code);
                    // a skipped account never reached IOCL, so the next one needn't wait for it
                    if (!r.skipped) lastLoginAt = Date.now();
                    console.log(`OilPortalInvoices: ${next.location_code} (${trigger}) - ${r.message || r.skipped || r.error}`);
                } catch (e) {
                    lastLoginAt = Date.now();
                    console.error(`OilPortalInvoices: ${next.location_code} failed:`, e.message);
                }
            }
        } catch (err) {
            console.error('OilPortalInvoices: run failed:', err.message);
        } finally {
            invoiceRun = null;
        }
    })();
    return invoiceRun;
}

function start() {
    cron.schedule(DAILY_CRON, () => runCheck('DAILY'));
    cron.schedule(INVOICE_CRON, () => runInvoiceImports('DAILY'), { timezone: 'Asia/Kolkata' });

    // Restarted during the day: finish today's run for the accounts not done yet
    setTimeout(() => {
        const m = istMinutesNow();
        if (m >= INVOICE_START_MIN_IST && m < INVOICE_END_HOUR_IST * 60) runInvoiceImports('STARTUP');
    }, 3 * 60 * 1000);
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

module.exports = { start, runCheck, runInvoiceImports, PORTAL_IOCL };
