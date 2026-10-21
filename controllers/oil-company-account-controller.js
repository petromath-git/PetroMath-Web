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
        const st = await credentialDao.getAttemptStats(bankId);
        let error = null;
        if (st.running) {
            error = 'An IOCL portal login for this account is already running. Please wait for it to finish.';
        } else if (st.todayCount >= DAILY_LOGIN_LIMIT) {
            error = `IOCL portal logins are limited to ${DAILY_LOGIN_LIMIT} per day for this account, so IOCL does not flag it. Try again tomorrow, or upload the Excel downloaded from the portal.`;
        } else if (purpose === 'PULL' && st.failStreak >= PULL_FAIL_STOP) {
            error = 'IOCL rejected the saved login twice in a row, so pulls are paused to protect the account. An Admin needs to re-enter the password in Masters → Oil Company Accounts.';
        } else if (purpose === 'SAVE' && st.failStreakToday >= SAVE_FAIL_STOP_TODAY) {
            error = `IOCL rejected ${st.failStreakToday} logins today. To avoid locking the account, check the password by logging in on the IOCL portal yourself, then try again tomorrow.`;
        } else if (purpose === 'PULL' && st.secsSinceLastPull !== null && st.secsSinceLastPull < PULL_COOLDOWN_SECS) {
            error = `This account was pulled ${fmtWait(st.secsSinceLastPull)} ago. Please try again in ${fmtWait(PULL_COOLDOWN_SECS - st.secsSinceLastPull)}.`;
        }
        if (error) {
            inFlight.delete(bankId);
            return { error };
        }
        const attemptId = await credentialDao.startAttempt({ bankId, locationCode, purpose, fromDate, toDate, userId });
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

async function isIoclAccount(bankId) {
    const template = await bankReconDao.getBankTemplate(bankId);
    return !!(template && String(template.bank_name || '').toUpperCase() === 'IOCL');
}

module.exports = {
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
            res.json({ success: true, enabled: true, today: todayYmd(), accounts });
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
    }
};
