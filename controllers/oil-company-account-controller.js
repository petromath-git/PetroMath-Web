// controllers/oil-company-account-controller.js
// "Oil Company Accounts" master (m_bank rows with is_oil_company='Y'), kept apart from Bank Master
// so portal logins are never asked for on a bank screen. Also hosts the IOCL e-Mitra statement pull,
// which hands the pulled file to the normal Upload Transactions preview.
const BankDao = require('../dao/bank-dao');
const bankReconDao = require('../dao/bank-reconciliation-dao');
const rolePermissionsDao = require('../dao/role-permissions-dao');
const credentialDao = require('../dao/oil-portal-credential-dao');
const secretBox = require('../utils/secret-box');
const ioclPortal = require('../services/iocl-portal-service');
const transactionUploadController = require('./transaction-upload-controller');
const { getLocationConfigValue } = require('../utils/location-config');
const portalHealth = require('../services/oil-portal-health-scheduler');
const tankReceiptController = require('./tank-receipt-controller');
const db = require('../db/db-connection');
const TankInvoiceDao = require('../dao/tank-invoice-dao');

const LOGIN_ROLES = ['Admin', 'PowerUser', 'SuperUser'];
const MAX_PULL_DAYS = 92;
const PORTAL_IOCL = 'IOCL_EMITRA';
const PORTAL_DISABLED_MSG = 'IOCL portal pull is not enabled for this location.';

// Safeguards so repeated clicks / a bad stored password can't get the dealer's IOCL account flagged.
// Derived from t_oil_portal_login_attempt (one row per IOCL login).
const DAILY_LOGIN_LIMIT = 5;          // pulls + "Check & Save", per account per day
const PULL_COOLDOWN_SECS = 120;       // between pulls of the same account
const PULL_FAIL_STOP = 2;             // consecutive rejected logins -> pulls paused until re-saved
const SAVE_FAIL_STOP_TODAY = 3;       // rejected logins today -> stop trying new passwords until tomorrow
const inFlight = new Set();           // bank_ids with a portal login running in this process

// Server-wide (all dealers share this server's IP towards IOCL):
const GLOBAL_LOGIN_GAP_MS = 30 * 1000;   // at least 30 s between any two IOCL logins from this server
const GLOBAL_MAX_WAIT_MS = 20 * 1000;    // wait up to 20 s for a slot, otherwise ask to retry
const SERVER_STOP_ACCOUNTS = 3;          // this many different accounts failing...
const SERVER_STOP_WINDOW_MIN = 60;       // ...within this window stops all IOCL logins until it clears
let nextGlobalSlotAt = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Claim the next server-wide login slot (synchronous, so concurrent requests can't share one)
function claimGlobalSlot() {
    const now = Date.now();
    const start = Math.max(now, nextGlobalSlotAt);
    const wait = start - now;
    if (wait > GLOBAL_MAX_WAIT_MS) return { retryInSecs: Math.ceil(wait / 1000) };
    const previous = nextGlobalSlotAt;
    nextGlobalSlotAt = start + GLOBAL_LOGIN_GAP_MS;
    return { wait, undo: () => { if (nextGlobalSlotAt === start + GLOBAL_LOGIN_GAP_MS) nextGlobalSlotAt = previous; } };
}

// If IOCL logins for several dealers failed recently, IOCL may be limiting this server: stop all
// logins rather than push harder. Clears by itself once the failures age out of the window.
let lastServerStopLogAt = 0;
async function getServerStop() {
    const rows = await credentialDao.getRecentFailingAccounts(SERVER_STOP_WINDOW_MIN);
    if (rows.length < SERVER_STOP_ACCOUNTS) return null;
    const secsLeft = Math.max(60, SERVER_STOP_WINDOW_MIN * 60 - Number(rows[SERVER_STOP_ACCOUNTS - 1].secs_ago));
    const resumeAt = new Date(Date.now() + secsLeft * 1000)
        .toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
    if (Date.now() - lastServerStopLogAt > 10 * 60 * 1000) {
        lastServerStopLogAt = Date.now();
        console.error(`IOCL PULL SERVER-WIDE STOP: logins for ${rows.length} accounts failed in the last ${SERVER_STOP_WINDOW_MIN} min (bank_ids ${rows.map(r => r.bank_id).join(', ')}). Pulls resume about ${resumeAt} IST.`);
    }
    return {
        resumeAt,
        message: `IOCL portal logins are paused on this server: logins for several dealers failed in the last hour, which can mean IOCL is limiting access. Pulls resume automatically around ${resumeAt}. Please upload the Excel downloaded from the portal meanwhile.`
    };
}

const getIoclHealth = () => credentialDao.getPortalHealth(portalHealth.PORTAL_IOCL).catch(() => null);
const healthChangedMsg = (h) => `IOCL changed its portal (noticed ${h.status_since ? new Date(h.status_since).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-') : 'recently'}), so the pull is paused until PetroMath is updated. Please upload the Excel downloaded from the portal instead.`;

function fmtWait(secs) {
    const m = Math.floor(secs / 60), s = secs % 60;
    return m ? `${m} min ${s} s` : `${s} s`;
}

// Checks every safeguard and, if allowed, logs a RUNNING attempt. Returns { attemptId } or { error }.
async function reserveAttempt({ bankId, locationCode, purpose, fromDate, toDate, userId }) {
    if (inFlight.has(bankId)) {
        return { error: 'An IOCL portal login for this account is already running. Please wait for it to finish.' };
    }
    inFlight.add(bankId);
    try {
        const [st, health, serverStop] = await Promise.all([credentialDao.getAttemptStats(bankId), getIoclHealth(), getServerStop()]);
        let error = null;
        if (serverStop) {
            error = serverStop.message;
        } else if (health && health.status === 'CHANGED') {
            error = healthChangedMsg(health);
        } else if (st.running) {
            error = 'An IOCL portal login for this account is already running. Please wait for it to finish.';
        } else if (st.todayCount >= DAILY_LOGIN_LIMIT) {
            error = `IOCL portal logins are limited to ${DAILY_LOGIN_LIMIT} per day for this account, so IOCL does not flag it. Try again tomorrow, or upload the Excel downloaded from the portal.`;
        } else if (purpose !== 'SAVE' && st.failStreak >= PULL_FAIL_STOP) {
            error = 'IOCL rejected the saved login twice in a row, so pulls are paused to protect the account. An Admin needs to re-enter the password in Masters → Oil Company Accounts.';
        } else if (purpose === 'SAVE' && st.failStreakToday >= SAVE_FAIL_STOP_TODAY) {
            error = `IOCL rejected ${st.failStreakToday} logins today. To avoid locking the account, check the password by logging in on the IOCL portal yourself, then try again tomorrow.`;
        } else if (purpose !== 'SAVE' && st.secsSinceLastPull !== null && st.secsSinceLastPull < PULL_COOLDOWN_SECS) {
            error = `This account was used on the IOCL portal ${fmtWait(st.secsSinceLastPull)} ago. Please try again in ${fmtWait(PULL_COOLDOWN_SECS - st.secsSinceLastPull)}.`;
        }
        if (error) {
            inFlight.delete(bankId);
            return { error };
        }
        // Space logins across all dealers on this server
        const slot = claimGlobalSlot();
        if (slot.retryInSecs) {
            inFlight.delete(bankId);
            return { error: `The IOCL portal is busy with other pulls from this server. Please try again in ${fmtWait(slot.retryInSecs)}.` };
        }
        let attemptId;
        try {
            if (slot.wait > 0) await sleep(slot.wait);
            attemptId = await credentialDao.startAttempt({ bankId, locationCode, purpose, fromDate, toDate, userId });
        } catch (e) {
            slot.undo();
            throw e;
        }
        return { attemptId };
    } catch (e) {
        inFlight.delete(bankId);
        throw e;
    }
}

async function releaseAttempt(bankId, attemptId, result, message) {
    inFlight.delete(bankId);
    await credentialDao.finishAttempt(attemptId, result, message).catch(err => console.error('finishAttempt failed:', err.message));
}

const attemptResult = (e) => (e && e.code === 'LOGIN_FAILED' ? 'LOGIN_FAILED' : 'ERROR');

const canManageLogin = (user) => LOGIN_ROLES.includes(user.Role);

// Location config gate (location row beats '*'); off unless explicitly 'Y'
async function isPortalEnabled(locationCode) {
    const v = await getLocationConfigValue(locationCode, 'IOCL_PORTAL_PULL_ENABLED', 'N');
    return String(v).toUpperCase() === 'Y';
}

function todayYmd() {
    // Server runs in UTC on AWS; statements are by IST date
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().slice(0, 10);
}

function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s + 'T00:00:00Z'));
}

// ---- IOCL purchase invoices (Fuel Invoice "Fetch from IOCL") ----
// One fetch = one IOCL login: list + PDFs of invoices not yet entered, kept here per location so
// picking an invoice afterwards needs no further login. Lost on restart (just fetch again).
const INVOICE_DEFAULT_DAYS = 7;
const INVOICE_MAX_DAYS = 31;
const INVOICE_CACHE_MS = 6 * 60 * 60 * 1000;
const invoiceCache = new Map();   // location_code -> { fetchedAt, fromDate, toDate, invoices[] }

function getCachedInvoices(locationCode) {
    const c = invoiceCache.get(locationCode);
    if (c && Date.now() - c.fetchedAt > INVOICE_CACHE_MS) {
        invoiceCache.delete(locationCode);
        return null;
    }
    return c || null;
}

function ymdMinusDays(ymd, days) {
    return new Date(new Date(ymd + 'T00:00:00Z').getTime() - days * 86400000).toISOString().slice(0, 10);
}

// The location's IOCL account with a saved portal login, if any
async function findIoclLogin(locationCode) {
    const rows = await credentialDao.findStatusByLocation(locationCode);
    const row = rows.find(r => r.portal_code === PORTAL_IOCL);
    return row ? credentialDao.findForBank(row.bank_id, locationCode) : null;
}

// invoice numbers already saved as Fuel Invoices at the location
async function getEnteredInvoiceNumbers(locationCode) {
    const rows = await db.sequelize.query(
        `SELECT invoice_number FROM t_tank_invoice WHERE location_id = :locationCode AND invoice_number IS NOT NULL`,
        { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }
    );
    return new Set(rows.map(r => String(r.invoice_number).trim()));
}

async function invoiceListPayload(locationCode, cache) {
    const entered = await getEnteredInvoiceNumbers(locationCode);
    return {
        fetched_at: cache.fetchedAt,
        from_date: cache.fromDate,
        to_date: cache.toDate,
        invoices: cache.invoices.map(inv => ({
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            vehicle_number: inv.vehicle_number,
            products: inv.products,
            entered: entered.has(inv.invoice_number),
            pdf_ready: !!inv.pdf,
            pdf_error: inv.pdf_error
        }))
    };
}

// Save a fetched invoice as a Fuel Invoice without a person, only when nothing needs a decision:
// the PDF reads, its number is the portal's, and every line maps to a product used before.
// Returns null when saved, else the reason it was left for the user.
async function autoSaveInvoice(locationCode, inv) {
    const parsed = await tankReceiptController.parseInvoiceForLocation(locationCode, inv.pdf, `${inv.invoice_number}.pdf`);
    const body = parsed.body;
    if (body.tempId) tankReceiptController.tempInvoiceStore.delete(body.tempId);
    if (!body.success) return body.error || 'could not read the PDF';

    const h = body.data.header || {};
    if (String(h.invoice_number || '').trim() !== inv.invoice_number) return 'invoice number in the PDF differs from the portal';
    if (!h.invoice_date) return 'no invoice date in the PDF';
    const lines = body.data.lines || [];
    if (!lines.length) return 'no product lines in the PDF';
    const unmapped = lines.filter(l => !(body.mappings || {})[l.product_name] || !(Number(l.quantity) > 0));
    if (unmapped.length) return `product not mapped yet: ${unmapped.map(l => l.product_name).join(', ')}`;

    // Entered by a person since the fetch started? Never overwrite it.
    if ((await getEnteredInvoiceNumbers(locationCode)).has(inv.invoice_number)) return null;

    const saveLines = lines.map(l => ({
        product_id: Number(body.mappings[l.product_name]),
        product_name: l.product_name,
        quantity: l.quantity,
        qty_unit: String(l.qty_unit || 'KL').toUpperCase() === 'KG' ? 'KG' : 'KL',
        rate_per_kl: l.rate_per_kl || null,
        density: l.density || null,
        hsn_code: l.hsn_code || null,
        total_line_amount: l.total_line_amount || null,
        charges: l.charges || []
    }));
    const header = {
        location_id: locationCode,
        supplier_id: Number(body.supplierId),
        supplier: body.supplier,
        invoice_number: inv.invoice_number,
        invoice_date: h.invoice_date,
        truck_number: h.truck_number || null,
        delivery_doc_no: h.delivery_doc_no || null,
        seal_lock_no: h.seal_lock_no || null,
        bay_number: h.bay_number ? String(h.bay_number).trim() : null,
        total_invoice_amount: h.total_invoice_amount || null,
        fuel_category: saveLines.some(l => l.qty_unit === 'KG') ? 'CNG' : 'MS_HSD'
    };
    await TankInvoiceDao.saveInvoice(header, saveLines, inv.pdf, locationCode, header.supplier_id, `${inv.invoice_number}.pdf`);
    return null;
}

// Daily automatic run for one location (called by the oil portal scheduler, one account at a time):
// fetch the last week's invoices and save the ones not yet entered. One IOCL login, same safeguards.
async function autoImportIoclInvoices(locationCode) {
    if (!(await isPortalEnabled(locationCode))) return { skipped: 'pull not enabled' };
    const cred = await findIoclLogin(locationCode);
    if (!cred) return { skipped: 'no portal login' };

    let password;
    try {
        password = secretBox.decrypt(cred.password_enc);
    } catch (e) {
        return { skipped: 'saved login cannot be read on this server' };
    }

    const toDate = todayYmd();
    const fromDate = ymdMinusDays(toDate, INVOICE_DEFAULT_DAYS);
    const slot = await reserveAttempt({ bankId: cred.bank_id, locationCode, purpose: 'INVOICE', fromDate, toDate, userId: 'AUTO' });
    if (slot.error) return { skipped: slot.error };

    let invoices;
    try {
        invoices = await ioclPortal.pullInvoices({
            username: cred.username, password, fromDate, toDate, skip: await getEnteredInvoiceNumbers(locationCode)
        });
    } catch (e) {
        await releaseAttempt(cred.bank_id, slot.attemptId, attemptResult(e), e.message);
        return { error: e.message };
    }

    const saved = [], left = [];
    for (const inv of invoices.filter(i => i.pdf)) {
        try {
            const reason = await autoSaveInvoice(locationCode, inv);
            if (reason) left.push(`${inv.invoice_number} (${reason})`); else saved.push(inv.invoice_number);
        } catch (e) {
            left.push(`${inv.invoice_number} (${e.message})`);
        }
    }
    invoices.filter(i => !i.pdf && i.pdf_error).forEach(i => left.push(`${i.invoice_number} (${i.pdf_error})`));

    const message = `auto: ${invoices.length} invoices, saved ${saved.length}${saved.length ? ' [' + saved.join(', ') + ']' : ''}`
        + (left.length ? `; left for user: ${left.join('; ')}` : '');
    await releaseAttempt(cred.bank_id, slot.attemptId, 'OK', message);
    // The Fuel Invoice page shows this list (anything left over gets "Fill form")
    invoiceCache.set(locationCode, { fetchedAt: Date.now(), fromDate, toDate, invoices });
    return { saved, left, message };
}

async function isIoclAccount(bankId) {
    const template = await bankReconDao.getBankTemplate(bankId);
    return !!(template && String(template.bank_name || '').toUpperCase() === 'IOCL');
}

module.exports = {
    autoImportIoclInvoices,

    getOilCompanyAccountsPage: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const [banks, templates, portalEnabled, canEdit, canAdd, canDisable] = await Promise.all([
                BankDao.findAll(locationCode),
                bankReconDao.getAllTemplates(),
                isPortalEnabled(locationCode),
                rolePermissionsDao.hasPermission(req.user.Role, locationCode, 'EDIT_BANK_MASTER'),
                rolePermissionsDao.hasPermission(req.user.Role, locationCode, 'ADD_BANK_MASTER'),
                rolePermissionsDao.hasPermission(req.user.Role, locationCode, 'DISABLE_BANK_MASTER')
            ]);

            const oilBanks = banks.filter(b => b.is_oil_company === 'Y');
            let ioclBankIds = [];
            const portalLogins = {};
            if (portalEnabled) {
                // Same template resolution as the upload (explicit template_id, else match by bank name)
                const ioclFlags = await Promise.all(oilBanks.map(b => isIoclAccount(b.bank_id)));
                ioclBankIds = oilBanks.filter((b, i) => ioclFlags[i]).map(b => b.bank_id);
                const loginRows = await credentialDao.findStatusByLocation(locationCode);
                const stats = await Promise.all(loginRows.map(r => credentialDao.getAttemptStats(r.bank_id)));
                loginRows.forEach((r, i) => {
                    portalLogins[r.bank_id] = Object.assign({}, r, {
                        paused: stats[i].failStreak >= PULL_FAIL_STOP,
                        loginsToday: stats[i].todayCount,
                        dailyLimit: DAILY_LOGIN_LIMIT
                    });
                });
            }

            res.render('bank-master', {
                title: 'Oil Company Accounts',
                user: req.user,
                mobileReady: true,   // same Mobile Cards table as Bank Master
                masterMode: 'OIL',
                banks: oilBanks,
                templates,
                canEdit,
                canAdd,
                canDisable,
                portalEnabled,
                portalHealth: portalEnabled ? await getIoclHealth() : null,
                canCheckPortalHealth: req.user.Role === 'SuperUser',
                portalLogins,
                ioclBankIds,
                canManageLogin: canManageLogin(req.user),
                portalKeyConfigured: secretBox.isConfigured()
            });
        } catch (error) {
            console.error('Error loading oil company accounts page:', error);
            res.status(500).send('Error loading oil company accounts page');
        }
    },

    getDisabledAccountsPage: async (req, res) => {
        try {
            const banks = await BankDao.findDisabledBanks(req.user.location_code);
            res.render('bank-master-enable', {
                title: 'Disabled Oil Company Accounts',
                user: req.user,
                masterMode: 'OIL',
                banks: banks.filter(b => b.is_oil_company === 'Y')
            });
        } catch (error) {
            console.error('Error loading disabled oil company accounts:', error);
            res.status(500).send('Error loading disabled oil company accounts');
        }
    },

    // Validate the login against the portal first, then store it. A wrong password is never saved.
    savePortalLogin: async (req, res) => {
        try {
            if (!canManageLogin(req.user)) {
                return res.status(403).json({ success: false, error: 'Only Admin can manage portal logins' });
            }
            if (!(await isPortalEnabled(req.user.location_code))) {
                return res.status(403).json({ success: false, error: PORTAL_DISABLED_MSG });
            }
            if (!secretBox.isConfigured()) {
                return res.status(500).json({ success: false, error: 'Portal login storage is not set up on this server (PORTAL_CRED_KEY missing).' });
            }

            const locationCode = req.user.location_code;
            const bankId = parseInt(req.params.id, 10);
            const username = String(req.body.username || '').trim();
            const password = String(req.body.password || '');

            const account = await credentialDao.findOilAccount(bankId, locationCode);
            if (!account) {
                return res.status(404).json({ success: false, error: 'Oil company account not found' });
            }
            if (!(await isIoclAccount(bankId))) {
                return res.status(400).json({ success: false, error: 'Portal pull is available only for IOCL accounts (IOCL SAP statement template).' });
            }
            if (!/^\d{4,10}$/.test(username)) {
                return res.status(400).json({ success: false, error: 'Username must be the RO SAP code (digits only).' });
            }
            if (!password) {
                return res.status(400).json({ success: false, error: 'Password is required' });
            }

            const today = todayYmd();
            const slot = await reserveAttempt({ bankId, locationCode, purpose: 'SAVE', userId: req.user.Person_id });
            if (slot.error) {
                return res.status(429).json({ success: false, error: slot.error });
            }
            let check;
            try {
                check = await ioclPortal.pullStatement({ username, password, fromDate: today, toDate: today });
            } catch (e) {
                await releaseAttempt(bankId, slot.attemptId, attemptResult(e), e.message);
                return res.status(400).json({ success: false, error: e.message || 'Could not log in to the IOCL portal' });
            }
            await releaseAttempt(bankId, slot.attemptId, 'OK', 'Login verified');

            await credentialDao.upsert({
                bankId,
                locationCode,
                portalCode: PORTAL_IOCL,
                username,
                passwordEnc: secretBox.encrypt(password),
                userId: req.user.Person_id
            });
            await credentialDao.recordPull(bankId, 'OK', 'Login verified');

            res.json({
                success: true,
                message: `Login verified for ${check.partnerName || username} and saved.`
            });
        } catch (error) {
            console.error('Error saving portal login:', error);
            res.status(500).json({ success: false, error: 'Error saving portal login' });
        }
    },

    // SuperUser: run the (no-login) portal health check now, e.g. after a fix is deployed
    checkPortalHealthNow: async (req, res) => {
        try {
            if (req.user.Role !== 'SuperUser') {
                return res.status(403).json({ success: false, error: 'Only SuperUser can run the portal check' });
            }
            if (!(await isPortalEnabled(req.user.location_code))) {
                return res.status(403).json({ success: false, error: PORTAL_DISABLED_MSG });
            }
            const result = await portalHealth.runCheck('MANUAL');
            if (!result) {
                return res.status(500).json({ success: false, error: 'The portal check could not run. See the server log.' });
            }
            res.json({ success: true, status: result.status, detail: result.detail });
        } catch (error) {
            console.error('Error running portal health check:', error);
            res.status(500).json({ success: false, error: 'Error running the portal check' });
        }
    },

    deletePortalLogin: async (req, res) => {
        try {
            if (!canManageLogin(req.user)) {
                return res.status(403).json({ success: false, error: 'Only Admin can manage portal logins' });
            }
            if (!(await isPortalEnabled(req.user.location_code))) {
                return res.status(403).json({ success: false, error: PORTAL_DISABLED_MSG });
            }
            const bankId = parseInt(req.params.id, 10);
            const account = await credentialDao.findOilAccount(bankId, req.user.location_code);
            if (!account) {
                return res.status(404).json({ success: false, error: 'Oil company account not found' });
            }
            await credentialDao.remove(bankId, req.user.location_code);
            res.json({ success: true, message: 'Portal login removed' });
        } catch (error) {
            console.error('Error removing portal login:', error);
            res.status(500).json({ success: false, error: 'Error removing portal login' });
        }
    },

    // For the Upload Transactions page: which accounts can be pulled, and the suggested From date
    getPullableAccounts: async (req, res) => {
        try {
            if (!(await isPortalEnabled(req.user.location_code))) {
                return res.json({ success: true, enabled: false, accounts: [] });
            }
            const rows = await credentialDao.findStatusByLocation(req.user.location_code);
            const accounts = await Promise.all(rows.map(async r => {
                const st = await credentialDao.getAttemptStats(r.bank_id);
                return {
                    bank_id: r.bank_id,
                    last_txn_date: await credentialDao.getLastTransactionDate(r.bank_id),
                    last_pull_at: r.last_pull_at,
                    last_pull_status: r.last_pull_status,
                    logins_left_today: Math.max(0, DAILY_LOGIN_LIMIT - st.todayCount),
                    daily_limit: DAILY_LOGIN_LIMIT,
                    paused: st.failStreak >= PULL_FAIL_STOP
                };
            }));
            const [health, serverStop] = await Promise.all([getIoclHealth(), getServerStop()]);
            res.json({
                success: true, enabled: true, today: todayYmd(), accounts,
                server_stop_message: serverStop ? serverStop.message : null,
                portal_health: health ? {
                    status: health.status,
                    checked_at: health.checked_at,
                    message: health.status === 'CHANGED' ? healthChangedMsg(health) : null
                } : null
            });
        } catch (error) {
            console.error('Error listing pullable accounts:', error);
            res.status(500).json({ success: false, error: 'Error loading portal accounts' });
        }
    },

    // Pull from the portal and run the normal upload preview on the pulled file
    pullStatement: async (req, res) => {
        const bankId = parseInt(req.params.id, 10);
        try {
            const locationCode = req.user.location_code;
            if (!(await isPortalEnabled(locationCode))) {
                return res.status(403).json({ success: false, error: PORTAL_DISABLED_MSG });
            }
            const fromDate = String(req.body.from_date || '');
            const toDate = String(req.body.to_date || '');

            if (!isYmd(fromDate) || !isYmd(toDate)) {
                return res.status(400).json({ success: false, error: 'Select valid From and To dates' });
            }
            if (fromDate > toDate) {
                return res.status(400).json({ success: false, error: 'From date is after To date' });
            }
            if (toDate > todayYmd()) {
                return res.status(400).json({ success: false, error: 'To date cannot be in the future' });
            }
            const days = (new Date(toDate) - new Date(fromDate)) / 86400000 + 1;
            if (days > MAX_PULL_DAYS) {
                return res.status(400).json({ success: false, error: `Pull at most ${MAX_PULL_DAYS} days at a time` });
            }

            const cred = await credentialDao.findForBank(bankId, locationCode);
            if (!cred || cred.is_oil_company !== 'Y') {
                return res.status(404).json({ success: false, error: 'No portal login saved for this account. Set it up in Masters → Oil Company Accounts.' });
            }

            let password;
            try {
                password = secretBox.decrypt(cred.password_enc);
            } catch (e) {
                console.error('Portal credential decrypt failed:', e.message);
                return res.status(500).json({ success: false, error: 'Saved portal login could not be read on this server. Please re-enter it in Oil Company Accounts.' });
            }

            const slot = await reserveAttempt({ bankId, locationCode, purpose: 'PULL', fromDate, toDate, userId: req.user.Person_id });
            if (slot.error) {
                return res.status(429).json({ success: false, error: slot.error });
            }
            let pulled;
            try {
                pulled = await ioclPortal.pullStatement({ username: cred.username, password, fromDate, toDate });
            } catch (e) {
                await releaseAttempt(bankId, slot.attemptId, attemptResult(e), e.message);
                await credentialDao.recordPull(bankId, 'FAILED', e.message);
                return res.status(502).json({ success: false, error: e.message || 'IOCL portal pull failed' });
            }
            await releaseAttempt(bankId, slot.attemptId, 'OK', `${pulled.rows.length} rows`);

            // Hand over to the existing upload preview exactly as if the user had uploaded the file
            req.body.bank_id = String(bankId);
            req.file = {
                buffer: pulled.buffer,
                originalname: pulled.fileName,
                mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                size: pulled.buffer.length
            };

            const originalJson = res.json.bind(res);
            res.json = (body) => {
                const ok = body && body.success;
                credentialDao.recordPull(bankId, ok ? 'OK' : 'FAILED',
                    ok ? `${pulled.rows.length} rows ${fromDate} to ${toDate}` : body && body.error)
                    .catch(err => console.error('recordPull failed:', err.message));
                if (body && typeof body === 'object') {
                    body.portal = {
                        from_date: fromDate,
                        to_date: toDate,
                        rows: pulled.rows.length,
                        opening_balance: pulled.openingBalance,
                        closing_balance: pulled.closingBalance,
                        file_name: pulled.fileName
                    };
                }
                return originalJson(body);
            };

            return transactionUploadController.previewTransactions(req, res);
        } catch (error) {
            console.error('Error pulling IOCL statement:', error);
            if (bankId) await credentialDao.recordPull(bankId, 'FAILED', error.message).catch(() => {});
            res.status(500).json({ success: false, error: 'Error pulling statement from IOCL portal' });
        }
    },

    // Fuel Invoice page: is "Fetch from IOCL" available, and the last fetched list (no login)
    getIoclInvoiceStatus: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            if (!(await isPortalEnabled(locationCode))) {
                return res.json({ success: true, enabled: false });
            }
            const cred = await findIoclLogin(locationCode);
            if (!cred) {
                return res.json({ success: true, enabled: true, has_login: false });
            }
            const st = await credentialDao.getAttemptStats(cred.bank_id);
            const cache = getCachedInvoices(locationCode);
            res.json({
                success: true, enabled: true, has_login: true,
                logins_left_today: Math.max(0, DAILY_LOGIN_LIMIT - st.todayCount),
                daily_limit: DAILY_LOGIN_LIMIT,
                paused: st.failStreak >= PULL_FAIL_STOP,
                default_from: ymdMinusDays(todayYmd(), INVOICE_DEFAULT_DAYS),
                today: todayYmd(),
                list: cache ? await invoiceListPayload(locationCode, cache) : null
            });
        } catch (error) {
            console.error('Error loading IOCL invoice status:', error);
            res.status(500).json({ success: false, error: 'Error loading IOCL invoice status' });
        }
    },

    // One IOCL login: list invoices and download the PDFs of those not yet entered
    fetchIoclInvoices: async (req, res) => {
        let bankId = null;
        try {
            const locationCode = req.user.location_code;
            if (!(await isPortalEnabled(locationCode))) {
                return res.status(403).json({ success: false, error: PORTAL_DISABLED_MSG });
            }
            const toDate = isYmd(req.body.to_date) ? req.body.to_date : todayYmd();
            const fromDate = isYmd(req.body.from_date) ? req.body.from_date : ymdMinusDays(toDate, INVOICE_DEFAULT_DAYS);
            if (fromDate > toDate) {
                return res.status(400).json({ success: false, error: 'From date is after To date' });
            }
            if (toDate > todayYmd()) {
                return res.status(400).json({ success: false, error: 'To date cannot be in the future' });
            }
            if ((new Date(toDate) - new Date(fromDate)) / 86400000 + 1 > INVOICE_MAX_DAYS) {
                return res.status(400).json({ success: false, error: `Fetch at most ${INVOICE_MAX_DAYS} days at a time` });
            }

            const cred = await findIoclLogin(locationCode);
            if (!cred) {
                return res.status(404).json({ success: false, error: 'No IOCL portal login saved for this location. Set it up in Masters → Oil Company Accounts.' });
            }
            bankId = cred.bank_id;

            let password;
            try {
                password = secretBox.decrypt(cred.password_enc);
            } catch (e) {
                console.error('Portal credential decrypt failed:', e.message);
                return res.status(500).json({ success: false, error: 'Saved portal login could not be read on this server. Please re-enter it in Oil Company Accounts.' });
            }

            const slot = await reserveAttempt({ bankId, locationCode, purpose: 'INVOICE', fromDate, toDate, userId: req.user.Person_id });
            if (slot.error) {
                return res.status(429).json({ success: false, error: slot.error });
            }
            let invoices;
            try {
                const skip = await getEnteredInvoiceNumbers(locationCode);
                invoices = await ioclPortal.pullInvoices({ username: cred.username, password, fromDate, toDate, skip });
            } catch (e) {
                await releaseAttempt(bankId, slot.attemptId, attemptResult(e), e.message);
                return res.status(502).json({ success: false, error: e.message || 'IOCL invoice fetch failed' });
            }
            const pdfs = invoices.filter(i => i.pdf).length;
            await releaseAttempt(bankId, slot.attemptId, 'OK', `${invoices.length} invoices, ${pdfs} PDFs`);

            const cache = { fetchedAt: Date.now(), fromDate, toDate, invoices };
            invoiceCache.set(locationCode, cache);
            res.json({ success: true, list: await invoiceListPayload(locationCode, cache) });
        } catch (error) {
            console.error('Error fetching IOCL invoices:', error);
            res.status(500).json({ success: false, error: 'Error fetching invoices from IOCL portal' });
        }
    },

    // Read one fetched invoice PDF into the Fuel Invoice form (same JSON as the PDF upload)
    readIoclInvoice: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const invoiceNumber = String(req.params.invoiceNumber || '').trim();
            const cache = getCachedInvoices(locationCode);
            const inv = cache && cache.invoices.find(i => i.invoice_number === invoiceNumber);
            if (!inv || !inv.pdf) {
                return res.status(404).json({ success: false, error: 'This invoice PDF is no longer available. Please fetch from IOCL again.' });
            }
            const result = await tankReceiptController.parseInvoiceForLocation(locationCode, inv.pdf, `${invoiceNumber}.pdf`);
            res.status(result.status).json(result.body);
        } catch (error) {
            console.error('Error reading IOCL invoice:', error);
            res.status(500).json({ success: false, error: 'Failed to read invoice: ' + error.message });
        }
    }
};
