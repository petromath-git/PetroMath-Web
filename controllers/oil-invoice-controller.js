// controllers/oil-invoice-controller.js — IOCL Invoices (/oil-invoices), tkt #484.
//
// A register of the GST invoices IOCL sends for the charges it debits to the SAP account
// (LFR, E-Lock, participation fee, merchant consent incentive, VMUS ...). Tabs:
//   invoices  upload PDFs (several at once), list with the SAP debit each is linked to
//   sap       charge debits on the SAP account, with or without an invoice
//   lfr       the fuel invoices each LFR invoice charges, checked against Tank Receipts
const dateFormat = require('dateformat');
const OilInvoiceDao = require('../dao/oil-invoice-dao');
const OilInvoiceService = require('../services/oil-invoice-service');
const gstUtils = require('../utils/gst-utils');
const { sendDocument } = require('../utils/attachment-upload');

const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const fmtAmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? dateFormat(d instanceof Date ? d : `${String(d).substring(0, 10)}T00:00:00`, 'dd-mmm-yyyy') : '';
const TABS = [['invoices', 'Invoices'], ['sap', 'SAP Charges'], ['lfr', 'LFR Check']];

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
};
