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

const PORTAL_BASE = 'https://utkarsh.indianoil.co.in';
const LOGIN_URL = `${PORTAL_BASE}/sdmspro/auth/login`;
const STATEMENT_PAGE_URL = `${PORTAL_BASE}/sdmspro/accounts/account-summary`;
const STATEMENT_API_PATH = '/xepp-api/dealer-account/fetch-statement';

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

async function login(page, username, password) {
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });

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
        r => r.url().includes('/xepp-api/auth/samadhan/login') && r.request().method() === 'POST',
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

    const resp = await loginResponse;
    if (resp && resp.status() >= 400) {
        let msg = '';
        try { msg = (await resp.json()).message || ''; } catch (e) { /* ignore */ }
        throw new PortalError(`IOCL portal rejected the login${msg ? ': ' + msg : ''}. Check the username and password.`, 'LOGIN_FAILED');
    }

    try {
        await page.waitForFunction(() => location.href.includes('/dashboard'), { timeout: 30000 });
    } catch (e) {
        const screenText = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '');
        throw new PortalError(`IOCL login did not complete. ${screenText.replace(/\s+/g, ' ').trim()}`.trim(), 'LOGIN_FAILED');
    }
}

async function fetchStatementJson(page, fromDate, toDate) {
    // Load the statement screen so the API call goes out with the same origin/referer as the portal.
    await page.goto(STATEMENT_PAGE_URL, { waitUntil: 'networkidle2', timeout: 60000 });

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
        const browser = await getBrowser();
        const context = await browser.createBrowserContext();
        try {
            const page = await context.newPage();
            await page.setViewport({ width: 1366, height: 900 });
            page.setDefaultTimeout(60000);

            await login(page, username, password);
            const { json, roCode, partnerName } = await fetchStatementJson(page, fromDate, toDate);

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

module.exports = {
    pullStatement,
    PortalError,
    // exported for tests
    solveMathQuestion,
    toExcelRows,
    EXCEL_HEADER
};
