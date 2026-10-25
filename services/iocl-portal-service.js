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
// "TT Acknowledgement / Download Invoice" screen: invoice list + digital invoice PDF.
// Only these two are used — the screen's Check / Acknowledge (receipt + vehicle condition) stay manual.
const INVOICE_LIST_API_PART = '/retaildbapi/retaildbapi/fetch-invoices';
const INVOICE_PDF_API_PATH = '/xepp-api/api-req/post-data/172';
const MAX_INVOICE_PDFS = 15;

// Present as an ordinary desktop Chrome (the dealer's own browser would), not "HeadlessChrome" on Linux
// with an 800x600 screen. Version follows the bundled Chrome so it stays consistent.
async function preparePage(page, browser) {
    const major = ((await browser.version()).match(/\/(\d+)\./) || [])[1] || '131';
    await page.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-IN,en;q=0.9' });
    await page.setViewport({ width: 1366, height: 768 });
}

async function portalUrls() {
    const raw = await getLocationConfigValue('*', 'IOCL_PORTAL_BASE_URL', DEFAULT_PORTAL_BASE);
    const base = String(raw || DEFAULT_PORTAL_BASE).trim().replace(/\/+$/, '');
    return {
        base,
        login: `${base}/sdmspro/auth/login`,
        statementPage: `${base}/sdmspro/accounts/account-summary`,
        invoicePage: `${base}/sdmspro/indent/receipt-ack`
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
            await preparePage(page, browser);
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

const ymdCompact = (ymd) => String(ymd).replace(/-/g, '');
const ymdFromCompact = (s) => (/^\d{8}$/.test(String(s || '')) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

async function fetchInvoiceList(page, fromDate, toDate, urls) {
    // The screen lists the last week by itself on load; take its own request body (partner code,
    // employee login id, ...) and re-send it for the dates we want.
    const ownRequest = page.waitForRequest(
        r => r.url().includes(INVOICE_LIST_API_PART) && r.method() === 'POST', { timeout: 30000 }
    ).catch(() => null);
    await page.goto(urls.invoicePage, { waitUntil: 'networkidle2', timeout: 60000 });
    const req = await ownRequest;
    let body = null;
    try { body = req ? JSON.parse(req.postData()) : null; } catch (e) { /* not JSON */ }
    if (!body || !body.PartnerCode) {
        throw new PortalError('The IOCL invoice screen did not load its invoice list. The portal may have changed.', 'INVOICE_FAILED');
    }
    body.FromDate = ymdCompact(fromDate);
    body.ToDate = ymdCompact(toDate);

    const result = await page.evaluate(async (apiUrl, payload) => {
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'Accept': 'application/json, text/plain, */*',
                'Authorization': 'Bearer ' + localStorage.getItem('accessToken'),
                'x-auth-user': localStorage.getItem('userId'),
                'custcode': localStorage.getItem('roCode')
            },
            body: JSON.stringify(payload)
        });
        return { status: res.status, text: await res.text() };
    }, req.url(), body);

    let json = null;
    try { json = JSON.parse(result.text); } catch (e) { /* not JSON */ }
    if (result.status !== 200 || !json || String(json.errorCode) !== '0') {
        const msg = json && json.errorMessage ? `: ${json.errorMessage}` : ` (HTTP ${result.status})`;
        throw new PortalError(`IOCL invoice list request failed${msg}.`, 'INVOICE_FAILED');
    }
    return (json.indentTrackingPOList || []).map(r => ({
        invoice_number: String(r.sapinvoiceNumber || '').trim(),
        invoice_date: ymdFromCompact(r.saporderDate || r.loadDispatchedDateTime),
        vehicle_number: r.vehicleNumber || null,
        products: (r.productDetails || []).map(p => ({
            name: p.productName || p.productShortCode || '',
            quantity: p.requestedQuantity !== '' && p.requestedQuantity != null ? Number(p.requestedQuantity) : null
        }))
    })).filter(r => r.invoice_number);
}

async function downloadInvoicePdf(page, invoiceNumber) {
    const result = await page.evaluate(async (apiPath, vbeln) => {
        const res = await fetch(apiPath, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'Accept': 'application/json, text/plain, */*',
                'Authorization': 'Bearer ' + localStorage.getItem('accessToken'),
                'x-auth-user': localStorage.getItem('userId'),
                'custcode': localStorage.getItem('roCode')
            },
            body: JSON.stringify({ I_VBELN: vbeln, TrackingId: '172_' + new Date().toISOString(), Source: 'XePP' })
        });
        return { status: res.status, text: await res.text() };
    }, INVOICE_PDF_API_PATH, invoiceNumber);

    let json = null;
    try { json = JSON.parse(result.text); } catch (e) { /* not JSON */ }
    const b64 = json && json.E_PDF_DATA && json.E_PDF_DATA.PDF;
    if (result.status !== 200 || !b64) {
        throw new Error((json && json.E_MSG) || `HTTP ${result.status}`);
    }
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.slice(0, 4).toString('ascii') !== '%PDF') throw new Error('IOCL did not return a PDF');
    return buffer;
}

/**
 * Log in once, list the dealer's invoices and download the PDFs of those not in `skip`.
 * @param {object} p { username, password, fromDate, toDate: 'YYYY-MM-DD', skip: Set of invoice numbers }
 * @returns {Promise<Array<{invoice_number, invoice_date, vehicle_number, products, pdf: Buffer|null, pdf_error}>>}
 */
function pullInvoices({ username, password, fromDate, toDate, skip }) {
    return serialize(async () => {
        const urls = await portalUrls();
        const browser = await getBrowser();
        const context = await browser.createBrowserContext();
        try {
            const page = await context.newPage();
            await preparePage(page, browser);
            page.setDefaultTimeout(60000);

            await login(page, username, password, urls);
            const invoices = await fetchInvoiceList(page, fromDate, toDate, urls);

            let downloads = 0;
            for (const inv of invoices) {
                inv.pdf = null;
                inv.pdf_error = null;
                if (skip && skip.has(inv.invoice_number)) continue;
                if (downloads >= MAX_INVOICE_PDFS) {
                    inv.pdf_error = `Only ${MAX_INVOICE_PDFS} PDFs are fetched at a time — fetch again for the rest.`;
                    continue;
                }
                if (downloads > 0) await new Promise(r => setTimeout(r, 1000));
                downloads++;
                try {
                    inv.pdf = await downloadInvoicePdf(page, inv.invoice_number);
                } catch (e) {
                    inv.pdf_error = `PDF download failed: ${e.message}`.slice(0, 200);
                }
            }
            return invoices;
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
            await preparePage(page, browser);
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
    pullInvoices,
    checkHealth,
    PortalError,
    // exported for tests
    preparePage,
    solveMathQuestion,
    toExcelRows,
    EXCEL_HEADER
};
