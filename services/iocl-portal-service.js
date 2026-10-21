// services/iocl-portal-service.js
// Pulls the dealer Account Statement from the IOCL e-Mitra portal (utkarsh.indianoil.co.in/sdmspro).
//
// The portal login form encrypts its payload in the browser, so login runs in headless Chrome
// (shared instance from browserHelper, isolated per pull in its own incognito context).
// After login the portal keeps its session tokens in localStorage; the statement is then fetched
// from the same JSON API the "Account Summary" screen uses (dealer-account/fetch-statement).
//
// Output rows mirror the portal's own "Download Excel" file column for column, so the result can be
// fed to the existing IOCL SAP Account Statement template (template_id 2) unchanged.
const XLSX = require('xlsx');
const { getBrowser } = require('../utils/browserHelper');
const { getLocationConfigValue } = require('../utils/location-config');

// Portal address comes from location config '*' IOCL_PORTAL_BASE_URL so a domain move is a settings
// change. Redirects (e.g. the old sdms.indianoil.in) are followed by the browser anyway, and the APIs
// below are called relative to whichever origin the login page ended up on.
const DEFAULT_PORTAL_BASE = 'https://utkarsh.indianoil.co.in';
const STATEMENT_API_PATH = '/xepp-api/dealer-account/fetch-statement';
const CAPTCHA_API_PATH = '/xepp-api/auth/samadhan/captcha-challenge';
const LOGIN_API_PART = '/xepp-api/auth/samadhan/login';

async function portalUrls() {
    const raw = await getLocationConfigValue('*', 'IOCL_PORTAL_BASE_URL', DEFAULT_PORTAL_BASE);
    const base = String(raw || DEFAULT_PORTAL_BASE).trim().replace(/\/+$/, '');
    return {
        base,
        login: `${base}/sdmspro/auth/login`,
        statementPage: `${base}/sdmspro/accounts/account-summary`
    };
}

const EXCEL_HEADER = ['PLANT', 'ITEM TEXT', 'DOCUMENT TYPE', 'DOCUMENT NUMBER', 'DATE', 'MATERIAL GROUP',
    'QUANTITY', 'UNIT', 'DEBIT', 'CREDIT', 'BALANCE'];

// One pull at a time per server: headless Chrome is heavy and the portal is slow.
let queue = Promise.resolve();
function serialize(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
}

class PortalError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code || 'PORTAL_ERROR';
    }
}

function solveMathQuestion(text) {
    const m = String(text || '').match(/(\d+)\s*([x×*+\-−])\s*(\d+)\s*=\s*\?/);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[3]);
    switch (m[2]) {
        case '+': return a + b;
        case '-':
        case '−': return a - b;
        default: return a * b;
    }
}

async function login(page, username, password, urls) {
    try {
        await page.goto(urls.login, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
        throw new PortalError(`Could not reach the IOCL portal (${urls.base}). It may be down for maintenance; please try later.`, 'UNREACHABLE');
    }

    const question = await page.evaluate(() => document.body.innerText);
    const answer = solveMathQuestion(question);
    if (answer === null) {
        throw new PortalError('Could not read the security question on the IOCL login page. The portal may have changed.', 'LOGIN_PAGE_CHANGED');
    }

    const inputs = await page.$$('input');
    if (inputs.length < 3) {
        throw new PortalError('IOCL login page layout has changed.', 'LOGIN_PAGE_CHANGED');
    }
    await inputs[0].type(String(username));
    await inputs[1].type(String(password));
    await inputs[2].type(String(answer));
    await new Promise(r => setTimeout(r, 800));

    const loginResponse = page.waitForResponse(
        r => r.url().includes(LOGIN_API_PART) && r.request().method() === 'POST',
        { timeout: 30000 }
    ).catch(() => null);

    const clicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => /sign in/i.test(b.innerText));
        if (!btn) return false;
        btn.click();
        return true;
    });
    if (!clicked) {
        throw new PortalError('IOCL login button not found. The portal may have changed.', 'LOGIN_PAGE_CHANGED');
    }

    // Only IOCL's own answer to the sign-in request decides "wrong password" (LOGIN_FAILED, which
    // counts towards pausing pulls). Anything else is the page or portal misbehaving, not the password.
    const resp = await loginResponse;
    if (!resp) {
        throw new PortalError('The IOCL login page did not send the sign-in request. The portal may have changed.', 'LOGIN_PAGE_CHANGED');
    }
    let body = null;
    try { body = await resp.json(); } catch (e) { /* not JSON */ }
    if (resp.status() >= 500) {
        throw new PortalError(`The IOCL portal had an error while signing in (HTTP ${resp.status()}). Please try later.`, 'UNREACHABLE');
    }
    if (resp.status() >= 400 || !body || !body.token) {
        const msg = body && (body.message || body.error) ? String(body.message || body.error) : '';
        throw new PortalError(`IOCL portal rejected the login${msg ? ': ' + msg : ''}. Check the username and password.`, 'LOGIN_FAILED');
    }

    try {
        await page.waitForFunction(() => location.href.includes('/dashboard'), { timeout: 30000 });
    } catch (e) {
        throw new PortalError('Signed in to IOCL, but the portal did not open its dashboard. The portal may have changed.', 'LOGIN_PAGE_CHANGED');
    }
}

async function fetchStatementJson(page, fromDate, toDate, urls) {
    // Load the statement screen so the API call goes out with the same origin/referer as the portal.
    await page.goto(urls.statementPage, { waitUntil: 'networkidle2', timeout: 60000 });

    const result = await page.evaluate(async (apiPath, from, to) => {
        const token = localStorage.getItem('accessToken');
        const userId = localStorage.getItem('userId');
        const roCode = localStorage.getItem('roCode');
        if (!token || !userId || !roCode) {
            return { error: 'Session tokens not found after login' };
        }
        const res = await fetch(apiPath, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'Accept': 'application/json, text/plain, */*',
                'Authorization': 'Bearer ' + token,
                'x-auth-user': userId,
                'custcode': roCode
            },
            body: JSON.stringify({
                I_KUNNR: roCode,
                FROM_DT: from,
                TO_DT: to,
                roName: localStorage.getItem('partnerName') || ''
            })
        });
        const text = await res.text();
        return { status: res.status, text, roCode, partnerName: localStorage.getItem('partnerName') || '' };
    }, STATEMENT_API_PATH, fromDate, toDate);

    if (result.error) throw new PortalError(result.error, 'SESSION_ERROR');
    if (result.status !== 200) {
        throw new PortalError(`IOCL statement request failed (HTTP ${result.status}).`, 'STATEMENT_FAILED');
    }

    let json;
    try {
        json = JSON.parse(result.text);
    } catch (e) {
        throw new PortalError('IOCL statement response was not valid JSON.', 'STATEMENT_FAILED');
    }
    return { json, roCode: result.roCode, partnerName: result.partnerName };
}

// Same cell values the portal writes into account_statement.xlsx
function toExcelRows(json) {
    const items = (json && json.epad && json.epad.item) || [];
    const list = Array.isArray(items) ? items : [items];
    return list.map(it => [
        it.ORT02 || '',
        it.SGTXT || '',
        it.LTEXT || '',
        it.XBLNR || '',
        it.BUDAT || '',
        it.MATKL || '',
        it.FKIMG || '',
        it.VRKME || '',
        it.DEBIT ?? '',
        it.CREDIT ?? '',
        it.CUMM ?? ''
    ]);
}

function buildWorkbookBuffer(rows) {
    const ws = XLSX.utils.aoa_to_sheet([EXCEL_HEADER, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Log in and pull the statement.
 * @param {object} p { username, password, fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD' }
 * @returns {Promise<{rows, buffer, fileName, openingBalance, closingBalance, roCode, partnerName}>}
 */
function pullStatement({ username, password, fromDate, toDate }) {
    return serialize(async () => {
        const urls = await portalUrls();
        const browser = await getBrowser();
        const context = await browser.createBrowserContext();
        try {
            const page = await context.newPage();
            await page.setViewport({ width: 1366, height: 900 });
            page.setDefaultTimeout(60000);

            await login(page, username, password, urls);
            const { json, roCode, partnerName } = await fetchStatementJson(page, fromDate, toDate, urls);

            const rows = toExcelRows(json);
            return {
                rows,
                buffer: buildWorkbookBuffer(rows),
                fileName: `IOCL_${String(roCode).replace(/^0+/, '')}_${fromDate}_${toDate}.xlsx`,
                openingBalance: json.eopBal && json.eopBal.item ? json.eopBal.item.OPBAL : null,
                closingBalance: json.eclBal ?? null,
                roCode,
                partnerName
            };
        } finally {
            await context.close().catch(() => {});
        }
    });
}

/**
 * Health check WITHOUT logging in (uses none of the daily logins): does the portal still look the way
 * the pull expects? Returns { status: 'OK' | 'UNREACHABLE' | 'CHANGED', detail }.
 */
function checkHealth() {
    return serialize(async () => {
        const urls = await portalUrls();
        const browser = await getBrowser();
        const context = await browser.createBrowserContext();
        try {
            const page = await context.newPage();
            try {
                await page.goto(urls.login, { waitUntil: 'networkidle2', timeout: 45000 });
            } catch (e) {
                return { status: 'UNREACHABLE', detail: `Login page did not load from ${urls.base}: ${e.message}`.slice(0, 500) };
            }

            const shape = await page.evaluate(() => ({
                text: document.body.innerText,
                inputs: document.querySelectorAll('input').length,
                signIn: [...document.querySelectorAll('button')].some(b => /sign in/i.test(b.innerText)),
                finalUrl: location.href
            }));
            const problems = [];
            if (shape.inputs < 3) problems.push(`expected 3 login fields, found ${shape.inputs}`);
            if (!shape.signIn) problems.push('no "Sign in" button');
            if (solveMathQuestion(shape.text) === null) problems.push('security question not in the expected "a x b = ?" form');

            // APIs the pull depends on, called the same way the portal does (no credentials)
            // Only the public API the login page itself calls (the security-question challenge).
            // The statement API is deliberately NOT probed: unauthenticated POSTs to it get dropped by
            // IOCL's firewall, and hammering a protected endpoint daily isn't something to do from a
            // dealer's server. A changed statement API shows up as a clear error at pull time.
            // Up to 3 tries 2 s apart so one dropped request doesn't warn every dealer.
            const api = await page.evaluate(async (captchaPath) => {
                const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                let last;
                for (let i = 0; i < 3; i++) {
                    try {
                        const r = await fetch(captchaPath);
                        last = { status: r.status, hasKey: /publicKey/.test(await r.text()) };
                        if (last.status < 500) break;
                    } catch (e) { last = { error: String(e) }; }
                    await sleep(2000);
                }
                return { captcha: last };
            }, CAPTCHA_API_PATH);

            const serverDown = !!(api.captcha.error || api.captcha.status >= 500);
            if (!serverDown && !(api.captcha.status === 200 && api.captcha.hasKey)) {
                problems.push(`login security API answered ${api.captcha.status} without its key`);
            }

            if (problems.length) {
                return { status: 'CHANGED', detail: `${shape.finalUrl}: ${problems.join('; ')}`.slice(0, 500) };
            }
            if (serverDown) {
                return { status: 'UNREACHABLE', detail: `Portal APIs not answering: ${JSON.stringify(api)}`.slice(0, 500) };
            }
            return { status: 'OK', detail: `Login page and APIs as expected (${shape.finalUrl})` };
        } finally {
            await context.close().catch(() => {});
        }
    });
}

module.exports = {
    pullStatement,
    checkHealth,
    PortalError,
    // exported for tests
    solveMathQuestion,
    toExcelRows,
    EXCEL_HEADER
};
