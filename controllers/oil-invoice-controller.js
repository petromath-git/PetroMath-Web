// controllers/oil-invoice-controller.js — IOCL Invoices (/oil-invoices), tkt #484.
//
// A register of the GST invoices IOCL sends for the charges it debits to the SAP account
// (LFR, E-Lock, participation fee, merchant consent incentive, VMUS ...). Tabs:
//   invoices  upload PDFs (several at once), list with the SAP debit each is linked to
//   sap       charge debits on the SAP account, with or without an invoice
//   lfr       the fuel invoices each LFR invoice charges, checked against Tank Receipts
const crypto = require('crypto');
const dateFormat = require('dateformat');
const OilInvoiceDao = require('../dao/oil-invoice-dao');
const OilInvoiceService = require('../services/oil-invoice-service');
const gstUtils = require('../utils/gst-utils');
const { sendDocument } = require('../utils/attachment-upload');
const security = require('../utils/app-security');
const secretBox = require('../utils/secret-box');
const MailboxDao = require('../dao/oil-invoice-mailbox-dao');
const EmailService = require('../services/oil-invoice-email-service');

const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const fmtAmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? dateFormat(d instanceof Date ? d : `${String(d).substring(0, 10)}T00:00:00`, 'dd-mmm-yyyy') : '';
// date + time in IST, e.g. 21-Nov-2026 09:11
const fmtDateTime = (d) => {
    if (!d) return '';
    const t = new Date(d);
    if (isNaN(t)) return '';
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t).map(x => [x.type, x.value]));
    return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
};
const TABS = [['invoices', 'Invoices'], ['sap', 'SAP Charges'], ['lfr', 'LFR Check'], ['email', 'Email Import']];

// Bunks this user may tick on a mailbox: the ones they can open that have an IOCL SAP account.
async function tickableLocations(user) {
    const rows = await MailboxDao.getIoclLocations(security.getAccessibleLocations(user));
    return rows.map(r => r.location_code);
}
// A user may change a mailbox only if they can open every bunk on it.
const canManage = (user, box) => box.locations.every(l => security.canAccessLocation(user, l));

const cleanPassword = (p) => String(p || '').replace(/\s+/g, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Google script key: random, shown once inside the script; only its SHA-256 is stored.
const newScriptKey = () => crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const inboundUrl = (req) => {
    const host = req.get('host');
    const proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? req.protocol : 'https';
    return `${proto}://${host}/oil-invoices/inbound`;
};

// Validates the body of a mailbox save. Returns { error } or { email, mode, password, locations, lookbackDays, active }.
async function readMailboxBody(req, isNew, currentMode) {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (isNew && !EMAIL_RE.test(email)) return { error: 'Enter the Gmail address the invoices are forwarded to.' };
    const mode = isNew ? (b.mode === 'IMAP' ? 'IMAP' : 'SCRIPT') : currentMode;
    const password = mode === 'IMAP' ? cleanPassword(b.password) : '';
    if (isNew && mode === 'IMAP' && !password) return { error: 'Enter the App Password of this Gmail account.' };
    if (password && password.length < 8) return { error: 'That does not look like an App Password (16 letters from Google Account > Security > App passwords).' };
    const wanted = Array.from(new Set((Array.isArray(b.locations) ? b.locations : [b.locations]).filter(Boolean).map(String)));
    if (!wanted.length) return { error: 'Tick at least one bunk.' };
    const allowed = await tickableLocations(req.user);
    const bad = wanted.filter(l => !allowed.includes(l));
    if (bad.length) return { error: `You cannot add ${bad.join(', ')} (not your bunk, or no IOCL SAP account).` };
    const lookbackDays = Math.min(Math.max(parseInt(b.lookback_days, 10) || 30, 1), 365);
    return { email, mode, password, locations: wanted, lookbackDays, active: b.active === 'N' ? 'N' : 'Y' };
}

function fyRange(d) {
    const fy = gstUtils.getFinancialYear(d || new Date());
    const start = Number(fy.split('-')[0]);
    return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

const fileList = (req) => (req.files || []).filter(f => f && f.buffer);

module.exports = {
    getPage: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const account = await OilInvoiceDao.getIoclAccount(locationCode);
            const tab = TABS.some(t => t[0] === req.query.tab) ? req.query.tab : 'invoices';
            const fy = fyRange(isIsoDate(req.query.from) ? new Date(`${req.query.from}T00:00:00`) : new Date());
            const fromDate = isIsoDate(req.query.from) ? req.query.from : fy.from;
            const toDate = isIsoDate(req.query.to) ? req.query.to : fy.to;
            const data = { title: 'IOCL Invoices', user: req.user, mobileReady: true, fmtAmt, fmtDate, tabs: TABS, tab,
                account, fromDate, toDate, maxFiles: OilInvoiceService.MAX_FILES };
            if (!account) return res.render('oil-invoices/home', { ...data, notIocl: true });

            // a SAP statement uploaded since the last visit may now have the debits
            await OilInvoiceService.linkPending(locationCode, req.user.User_Name);

            if (tab === 'sap') {
                const sap = await OilInvoiceService.getSapCharges(locationCode, fromDate, toDate);
                return res.render('oil-invoices/home', { ...data, sap });
            }
            if (tab === 'lfr') {
                const lfr = await OilInvoiceService.getLfrCheck(locationCode, fromDate, toDate);
                return res.render('oil-invoices/home', { ...data, lfr });
            }
            if (tab === 'email') {
                const showOther = req.query.other === '1';
                const [mailboxes, log, tickable] = await Promise.all([
                    MailboxDao.getMailboxesForLocation(locationCode),
                    MailboxDao.getLogForLocation(locationCode, showOther, 300),
                    tickableLocations(req.user),
                ]);
                mailboxes.forEach(m => { m.canManage = canManage(req.user, m); });
                return res.render('oil-invoices/home', { ...data, mailboxes, log, tickable, showOther, fmtDateTime,
                    keyConfigured: secretBox.isConfigured(), autoRuns: process.env.ENVIRONMENT === 'prod' });
            }
            const [invoices, types] = await Promise.all([
                OilInvoiceDao.getInvoices(locationCode, fromDate, toDate), OilInvoiceDao.getChargeTypes(),
            ]);
            const byType = types.map(t => {
                const list = invoices.filter(i => i.charge_code === t.charge_code);
                return { ...t, count: list.length, total: list.reduce((s, i) => s + Number(i.total_amount), 0),
                    unlinked: list.filter(i => !i.t_bank_id && t.match_by !== 'NONE').length };
            }).filter(t => t.count);
            return res.render('oil-invoices/home', { ...data, invoices, byType });
        } catch (e) {
            next(e);
        }
    },

    // POST /oil-invoices/api/preview (multipart files) -> what each file holds
    preview: async (req, res) => {
        try {
            if (req.uploadError) return res.status(400).json({ success: false, error: req.uploadError });
            const files = fileList(req);
            if (!files.length) return res.status(400).json({ success: false, error: 'Choose the invoice PDF(s).' });
            const r = await OilInvoiceService.buildFromFiles(req.user.location_code, files);
            res.json({
                success: true,
                noAccount: !r.account,
                skippedFiles: r.skippedFiles,
                files: r.files.map(f => ({
                    file_name: f.file_name, status: f.status, error: f.error, problems: f.problems, warnings: f.warnings,
                    charge_code: f.charge_code, charge_name: f.charge_name,
                    invoice: f.invoice ? {
                        invoice_no: f.invoice.invoice_no, sap_ref: f.invoice.sap_ref, date: fmtDate(f.invoice.invoice_date),
                        service: f.invoice.service_head, description: f.invoice.description,
                        taxable: f.invoice.taxable_value, gst: f.invoice.cgst_amount + f.invoice.sgst_amount + f.invoice.igst_amount,
                        total: f.invoice.total_amount, rows: f.invoice.lines.length, kl: f.invoice.total_kl
                    } : null
                }))
            });
        } catch (e) {
            console.error('Oil invoices preview:', e);
            res.status(400).json({ success: false, error: e.message || 'Could not read the files.' });
        }
    },

    // POST /oil-invoices/api/save (multipart files) -> saves the new invoices
    save: async (req, res) => {
        try {
            if (req.uploadError) return res.status(400).json({ success: false, error: req.uploadError });
            const files = fileList(req);
            if (!files.length) return res.status(400).json({ success: false, error: 'Choose the invoice PDF(s).' });
            const r = await OilInvoiceService.saveFiles(req.user.location_code, files, req.user.User_Name);
            res.json({ success: true, ...r });
        } catch (e) {
            console.error('Oil invoices save:', e);
            res.status(400).json({ success: false, error: e.userFacing ? e.message : 'Could not save the invoices.' });
        }
    },

    // GET /oil-invoices/api/invoices/:id -> invoice with its LFR rows
    getInvoice: async (req, res) => {
        try {
            const inv = await OilInvoiceDao.getInvoice(req.user.location_code, Number(req.params.id));
            if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found.' });
            inv.date_display = fmtDate(inv.invoice_date);
            inv.sap_date_display = fmtDate(inv.sap_date);
            inv.lines.forEach(l => {
                l.delivery_date_display = fmtDate(l.delivery_date);
                l.purchase_invoice_date_display = fmtDate(l.purchase_invoice_date);
            });
            res.json({ success: true, invoice: inv });
        } catch (e) {
            console.error('Oil invoices getInvoice:', e);
            res.status(500).json({ success: false, error: 'Could not load the invoice.' });
        }
    },

    // GET /oil-invoices/:id/pdf -> the uploaded PDF (this location's invoices only)
    getPdf: async (req, res) => {
        try {
            const doc = await OilInvoiceDao.getInvoicePdf(req.user.location_code, Number(req.params.id));
            if (!doc) return res.status(404).send('Invoice PDF not found');
            sendDocument(res, doc, req.query.download === '1');
        } catch (e) {
            console.error('Oil invoices getPdf:', e);
            res.status(500).send('Could not load the PDF');
        }
    },

    // POST /oil-invoices/api/invoices/:id/delete
    deleteInvoice: async (req, res) => {
        try {
            const ok = await OilInvoiceDao.deleteInvoice(req.user.location_code, Number(req.params.id));
            if (!ok) return res.status(404).json({ success: false, error: 'Invoice not found.' });
            res.json({ success: true });
        } catch (e) {
            console.error('Oil invoices delete:', e);
            res.status(500).json({ success: false, error: 'Could not delete the invoice.' });
        }
    },

    // GET /oil-invoices/api/invoices/:id/candidates -> free SAP debits of the same amount
    getCandidates: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const [inv, account] = await Promise.all([
                OilInvoiceDao.getInvoice(locationCode, Number(req.params.id)), OilInvoiceDao.getIoclAccount(locationCode),
            ]);
            if (!inv || !account) return res.status(404).json({ success: false, error: 'Invoice not found.' });
            const rows = await OilInvoiceDao.getLinkCandidates(account.bank_id, Number(inv.total_amount));
            res.json({ success: true, candidates: rows.map(r => ({ ...r, date: fmtDate(r.trans_date) })) });
        } catch (e) {
            console.error('Oil invoices candidates:', e);
            res.status(500).json({ success: false, error: 'Could not load the SAP debits.' });
        }
    },

    // POST /oil-invoices/api/invoices/:id/link { t_bank_id } (empty = unlink)
    link: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const invoiceId = Number(req.params.id);
            const inv = await OilInvoiceDao.getInvoice(locationCode, invoiceId);
            if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found.' });
            const tBankId = Number(req.body.t_bank_id) || null;
            await OilInvoiceDao.unlinkSapDebit(locationCode, invoiceId, req.user.User_Name, !tBankId);
            if (!tBankId) return res.json({ success: true });
            const account = await OilInvoiceDao.getIoclAccount(locationCode);
            const debit = account && await OilInvoiceDao.getSapDebit(account.bank_id, tBankId);
            if (!debit) return res.status(400).json({ success: false, error: 'That SAP debit is not on this bunk\'s IOCL account.' });
            if (Math.abs(Number(debit.debit_amount) - Number(inv.total_amount)) >= 0.01) {
                return res.status(400).json({ success: false, error: 'The SAP debit amount differs from the invoice total.' });
            }
            const ok = await OilInvoiceDao.linkSapDebit(invoiceId, tBankId, 'MANUAL', req.user.User_Name);
            if (!ok) return res.status(400).json({ success: false, error: 'That SAP debit is already linked to another invoice.' });
            res.json({ success: true });
        } catch (e) {
            console.error('Oil invoices link:', e);
            res.status(500).json({ success: false, error: 'Could not link the SAP debit.' });
        }
    },

    // ── Email import ─────────────────────────────────────────────────────────
    // POST /oil-invoices/api/mailboxes { email, password, locations[], lookback_days }
    createMailbox: async (req, res) => {
        try {
            const v = await readMailboxBody(req, true);
            if (v.error) return res.status(400).json({ success: false, error: v.error });
            if (await MailboxDao.getMailboxByEmail(v.email)) {
                return res.status(400).json({ success: false, error: `${v.email} is already set up. Edit it there (tick your bunk) instead of adding it again.` });
            }
            if (v.mode === 'SCRIPT') {
                const key = newScriptKey();
                const id = await MailboxDao.createMailbox({ email: v.email, mode: 'SCRIPT', tokenHash: sha256(key), lookbackDays: v.lookbackDays },
                    v.locations, req.user.User_Name);
                return res.json({ success: true, mailbox_id: id, email: v.email, script: EmailService.buildScript(inboundUrl(req), key, v.lookbackDays) });
            }
            if (!secretBox.isConfigured()) return res.status(400).json({ success: false, error: 'Password storage is not set up on this server (PORTAL_CRED_KEY missing).' });
            const test = await EmailService.testLogin(v.email, v.password);
            if (!test.ok) return res.status(400).json({ success: false, error: test.error });
            const id = await MailboxDao.createMailbox({ email: v.email, mode: 'IMAP', passwordEnc: secretBox.encrypt(v.password), lookbackDays: v.lookbackDays },
                v.locations, req.user.User_Name);
            res.json({ success: true, mailbox_id: id });
        } catch (e) {
            console.error('Oil invoices createMailbox:', e.message);
            res.status(500).json({ success: false, error: 'Could not save the mailbox.' });
        }
    },

    // POST /oil-invoices/api/mailboxes/:id { password (blank = keep), locations[], lookback_days, active }
    updateMailbox: async (req, res) => {
        try {
            const id = Number(req.params.id);
            const box = await MailboxDao.getMailbox(id);
            if (!box || !canManage(req.user, box)) return res.status(404).json({ success: false, error: 'Mailbox not found.' });
            const v = await readMailboxBody(req, false, box.access_mode);
            if (v.error) return res.status(400).json({ success: false, error: v.error });
            let passwordEnc = null;
            if (v.password) {
                if (!secretBox.isConfigured()) return res.status(400).json({ success: false, error: 'Password storage is not set up on this server (PORTAL_CRED_KEY missing).' });
                const test = await EmailService.testLogin(box.email_address, v.password, box.imap_host, box.imap_port);
                if (!test.ok) return res.status(400).json({ success: false, error: test.error });
                passwordEnc = secretBox.encrypt(v.password);
            }
            await MailboxDao.updateMailbox(id, { passwordEnc, lookbackDays: v.lookbackDays, active: v.active }, v.locations, req.user.User_Name);
            res.json({ success: true });
        } catch (e) {
            console.error('Oil invoices updateMailbox:', e.message);
            res.status(500).json({ success: false, error: 'Could not save the mailbox.' });
        }
    },

    // POST /oil-invoices/api/mailboxes/:id/delete (the import log goes with it; imported invoices stay)
    deleteMailbox: async (req, res) => {
        try {
            const id = Number(req.params.id);
            const box = await MailboxDao.getMailbox(id);
            if (!box || !canManage(req.user, box)) return res.status(404).json({ success: false, error: 'Mailbox not found.' });
            await MailboxDao.deleteMailbox(id);
            res.json({ success: true });
        } catch (e) {
            console.error('Oil invoices deleteMailbox:', e.message);
            res.status(500).json({ success: false, error: 'Could not remove the mailbox.' });
        }
    },

    // POST /oil-invoices/api/mailboxes/:id/run -> read the mailbox now
    runMailbox: async (req, res) => {
        try {
            const id = Number(req.params.id);
            const box = await MailboxDao.getMailbox(id);
            if (!box || !box.locations.includes(req.user.location_code)) return res.status(404).json({ success: false, error: 'Mailbox not found.' });
            if (box.access_mode === 'SCRIPT') {
                return res.status(400).json({ success: false, error: 'This mailbox sends by itself every hour. To send now: open the PetroMath script at script.google.com, choose "sendInvoices" and press Run.' });
            }
            const r = await EmailService.runMailbox(id, req.user.User_Name);
            if (r.status !== 'OK') return res.status(400).json({ success: false, error: r.message });
            res.json({ success: true, message: r.message, counts: r.counts });
        } catch (e) {
            console.error('Oil invoices runMailbox:', e.message);
            res.status(500).json({ success: false, error: 'Could not read the mailbox.' });
        }
    },

    // POST /oil-invoices/api/mailboxes/:id/script -> a new Google script (new key; the old script stops working)
    newScript: async (req, res) => {
        try {
            const id = Number(req.params.id);
            const box = await MailboxDao.getMailbox(id);
            if (!box || !canManage(req.user, box) || box.access_mode !== 'SCRIPT') return res.status(404).json({ success: false, error: 'Mailbox not found.' });
            const key = newScriptKey();
            await MailboxDao.setTokenHash(id, sha256(key), req.user.User_Name);
            res.json({ success: true, email: box.email_address, script: EmailService.buildScript(inboundUrl(req), key, box.lookback_days) });
        } catch (e) {
            console.error('Oil invoices newScript:', e.message);
            res.status(500).json({ success: false, error: 'Could not make the script.' });
        }
    },

    // POST /oil-invoices/inbound (no login; header X-PetroMath-Key) <- the Google script in the Gmail account
    inbound: async (req, res) => {
        try {
            const key = String(req.get('X-PetroMath-Key') || '');
            const box = key.length >= 20 ? await MailboxDao.getMailboxByTokenHash(sha256(key)) : null;
            if (!box) return res.status(401).json({ success: false, error: 'Unknown key. Make a new script in PetroMath (IOCL Invoices > Email Import).' });
            const r = await EmailService.receiveFromScript(box, req.body || {});
            res.json({ success: true, ...r });
        } catch (e) {
            console.error('Oil invoices inbound:', e.message);
            res.status(500).json({ success: false, error: 'PetroMath could not take the mail; it will be sent again.' });
        }
    },
};
