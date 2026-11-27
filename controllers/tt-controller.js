// controllers/tt-controller.js — Tank Truck Freight (/tt), Transport module phase 1
//
// The oil company raises the freight bill for the dealer's tank truck in the dealer's name
// (IOCL "Transportation Bill", every half month, GST under reverse charge, 194C TDS deducted).
// Upload the PDF -> preview -> save -> GL via Create Accounting -> GSTR-1 Table 4B.
// The bank part of the payment is tagged "TT FREIGHT - <oil company>" on the bank statement.
const dateFormat = require('dateformat');
const TtDao = require('../dao/tt-dao');
const TtService = require('../services/tt-service');
const security = require('../utils/app-security');
const gstUtils = require('../utils/gst-utils');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const clean = (v) => {
    const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
    return s === '' ? null : s;
};
const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const fmtAmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? dateFormat(d instanceof Date ? d : `${String(d).substring(0, 10)}T00:00:00`, 'dd-mmm-yyyy') : '';

const PAGES = {
    bills:  { title: 'Tank Truck Freight', basePath: '/tt', tabs: [['bills', 'Freight Bills'], ['payments', 'Payments'], ['card', 'Fleet Card'], ['recon', 'Reconciliation'], ['statement', 'Statement'], ['deleted', 'Deleted']] },
    master: { title: 'Tank Truck Master', basePath: '/tt/master', tabs: [['vendors', 'Oil Company Vendor'], ['trucks', 'Trucks'], ['cards', 'Fleet Cards']] },
};

// Financial year (Apr-Mar) of a date, as from / to
function fyRange(d) {
    const fy = gstUtils.getFinancialYear(d || new Date());
    const start = Number(fy.split('-')[0]);
    return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: fy };
}

function validateVendor(body) {
    const d = {
        vendor_name: clean(body.vendor_name),
        sac_code: clean(body.sac_code) || '996791',
        gst_rate: body.gst_rate === '' || body.gst_rate == null ? 5 : Number(body.gst_rate),
        tds_percent: body.tds_percent === '' || body.tds_percent == null ? 0 : Number(body.tds_percent),
        debtor_ledger_id: body.debtor_ledger_id ? Number(body.debtor_ledger_id) : null,
        income_ledger_id: body.income_ledger_id ? Number(body.income_ledger_id) : null,
        toll_ledger_id: body.toll_ledger_id ? Number(body.toll_ledger_id) : null,
        tds_ledger_id: body.tds_ledger_id ? Number(body.tds_ledger_id) : null,
        receipt_bank_id: body.receipt_bank_id ? Number(body.receipt_bank_id) : null,
        start_date: clean(body.start_date),
        active_flag: body.active_flag === 'N' ? 'N' : 'Y',
        notes: clean(body.notes),
    };
    if (!d.vendor_name) return { error: 'Vendor name is required.' };
    if (!/^\d{4,8}$/.test(d.sac_code)) return { error: 'SAC code must be 4 to 8 digits.' };
    if (![0, 5, 12, 18].includes(d.gst_rate)) return { error: 'GST rate must be 0, 5, 12 or 18.' };
    if (!(d.tds_percent >= 0 && d.tds_percent <= 10)) return { error: 'TDS % must be between 0 and 10.' };
    if (!isIsoDate(d.start_date)) return { error: 'Start date is required.' };
    if (!d.debtor_ledger_id || !d.income_ledger_id) return { error: 'Debtor and income ledgers are required.' };
    if (d.tds_percent > 0 && !d.tds_ledger_id) return { error: 'TDS ledger is required when TDS % is more than zero.' };
    return { data: d };
}

function validateVehicle(body) {
    const date = (v) => (isIsoDate(clean(v)) ? clean(v) : null);
    const d = {
        vehicle_no: (clean(body.vehicle_no) || '').toUpperCase().replace(/[\s-]/g, ''),
        vendor_id: body.vendor_id ? Number(body.vendor_id) : null,
        capacity_kl: body.capacity_kl === '' || body.capacity_kl == null ? null : Number(body.capacity_kl),
        fleet_card_id: clean(body.fleet_card_id),
        insurance_expiry: date(body.insurance_expiry),
        fc_expiry: date(body.fc_expiry),
        permit_expiry: date(body.permit_expiry),
        tax_expiry: date(body.tax_expiry),
        active_flag: body.active_flag === 'N' ? 'N' : 'Y',
        notes: clean(body.notes),
    };
    if (!/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(d.vehicle_no)) return { error: 'Vehicle number looks wrong (e.g. TN39BY1899).' };
    if (d.capacity_kl !== null && !(d.capacity_kl > 0 && d.capacity_kl < 100)) return { error: 'Capacity must be between 0 and 100 KL.' };
    return { data: d };
}

async function renderPage(req, res, next, pageKey) {
    const page = PAGES[pageKey];
    try {
        const locationCode = req.user.location_code;
        const vendors = await TtDao.getVendors(locationCode);
        const common = {
            title: page.title, page, user: req.user, mobileReady: true, fmtAmt, fmtDate,
            canBills: security.hasMenuChk(req.user, 'TT_FREIGHT'),
            canMaster: security.hasMenuChk(req.user, 'TT_MASTER'),
        };
        if (!vendors.length) return res.render('tt/home', { ...common, notSetUp: true });

        // Payments (payment advice upload) is BPCL's AP210 Excel: only where a BPCL vendor is set up
        const hasBpcl = vendors.some(v => v.oil_company === 'BPCL');
        const tabs = page.tabs.filter(t => t[0] !== 'payments' || hasBpcl);
        const tab = tabs.some(t => t[0] === req.query.tab) ? req.query.tab : tabs[0][0];
        const fy = fyRange(isIsoDate(req.query.from) ? new Date(req.query.from) : new Date());
        const fromDate = isIsoDate(req.query.from) ? req.query.from : fy.from;
        const toDate = isIsoDate(req.query.to) ? req.query.to : fy.to;
        const vendor = vendors.find(v => v.vendor_id === Number(req.query.vendor)) || vendors.find(v => v.active_flag === 'Y') || vendors[0];
        const data = { ...common, tab, tabs, vendors, vendor, fromDate, toDate };
        if (hasBpcl && (tab === 'payments' || tab === 'bills' || tab === 'recon')) {
            // Freight lines paid before their bill was uploaded get tied up now
            await TtDao.unlinkOrphanAdviceLines(locationCode);
            await TtDao.relinkAdviceLines(locationCode);
        }

        if (tab === 'payments') {
            const advices = await TtDao.getAdvices(locationCode, fromDate, toDate);
            const sum = (k) => round2(advices.reduce((s, a) => s + Number(a[k]), 0));
            const adviceTotals = { gross: sum('gross_amount'), freight: sum('freight_amount'), toll: sum('toll_amount'),
                card: sum('fleet_card_amount'), other: sum('other_recovery'), tds: sum('tds_amount'), net: sum('net_amount') };
            return res.render('tt/home', { ...data, advices, adviceTotals, receiptLabel: TtDao.receiptLabel(vendor.oil_company) });
        }

        if (pageKey === 'master') {
            const [vehicles, ledgers, banks, cards, expenseLedgers] = await Promise.all([
                TtDao.getVehicles(locationCode), TtDao.getLedgerChoices(locationCode), TtDao.getBanks(locationCode),
                TtDao.getCards(locationCode), TtDao.getExpenseLedgers(locationCode),
            ]);
            return res.render('tt/home', { ...data, vehicles, ledgers, banks, cards, expenseLedgers });
        }

        if (tab === 'card') {
            const [cards, statements] = await Promise.all([
                TtDao.getCards(locationCode), TtDao.getCardStatements(locationCode, fromDate, toDate),
            ]);
            return res.render('tt/home', { ...data, cards, statements });
        }

        if (tab === 'recon' && vendor.oil_company === 'BPCL') {
            const bpclRecon = await TtService.buildBpclReconciliation(locationCode, vendor, fromDate, toDate);
            return res.render('tt/home', { ...data, bpclRecon, receiptLabel: TtDao.receiptLabel(vendor.oil_company) });
        }

        if (tab === 'recon') {
            const recon = await TtService.buildReconciliation(locationCode, vendor.vendor_id, fromDate, toDate);
            const cards = await TtDao.getCards(locationCode);
            return res.render('tt/home', { ...data, recon, cards, receiptLabel: TtDao.receiptLabel(vendor.oil_company),
                monthLabel: (ym) => dateFormat(`${ym}-01T00:00:00`, 'mmm yyyy') });
        }

        if (tab === 'bills') {
            const [bills, oldLabelReceipts] = await Promise.all([
                TtDao.getInvoices(locationCode, fromDate, toDate),
                TtDao.getReceiptsOnIncomeLabels(locationCode, vendor.vendor_id),
            ]);
            if (hasBpcl) {
                const paid = await TtDao.getBillPaidStatus(locationCode, bills.filter(b => b.bill_type !== 'TOLL').map(b => b.invoice_id));
                const byId = new Map(paid.map(p => [p.invoice_id, p]));
                bills.forEach(b => {
                    const p = byId.get(b.invoice_id);
                    if (!p || !Number(p.paid_lines)) return;
                    b.paid = Number(p.paid_lines) >= Number(p.line_count) ? 'FULL' : 'PART';
                    b.paid_on = p.paid_on;
                    b.clearing_docs = p.clearing_docs;
                });
            }
            // Month subtotals, like the freight worksheet: two half-month bills, one payment
            const months = [];
            for (const b of bills) {
                const key = b.bill_date_iso.substring(0, 7);
                let m = months.find(x => x.key === key);
                if (!m) {
                    m = { key, label: dateFormat(`${key}-01T00:00:00`, 'mmm yyyy'), bills: [], taxable: 0, gst: 0, tds: 0, net: 0, trips: 0, kl: 0 };
                    months.push(m);
                }
                m.bills.push(b);
                m.taxable += Number(b.taxable_value); m.gst += Number(b.cgst_amount) + Number(b.sgst_amount) + Number(b.igst_amount);
                m.tds += Number(b.tds_amount); m.net += Number(b.net_receivable);
                // A toll bill lists the same trips as the freight bills again: don't count them twice
                if (b.bill_type !== 'TOLL') m.trips += Number(b.trip_count);
                m.kl += Number(b.total_kl);
            }
            const totals = months.reduce((t, m) => {
                ['taxable', 'gst', 'tds', 'net', 'trips', 'kl'].forEach(k => { t[k] += m[k]; });
                return t;
            }, { taxable: 0, gst: 0, tds: 0, net: 0, trips: 0, kl: 0 });
            return res.render('tt/home', { ...data, months, totals, billCount: bills.length, oldLabelReceipts, receiptLabel: TtDao.receiptLabel(vendor.oil_company) });
        }

        if (tab === 'statement') {
            const [opening, rows, oldLabelReceipts] = await Promise.all([
                TtDao.getOpeningBalance(locationCode, vendor.vendor_id, fromDate),
                TtDao.getStatement(locationCode, vendor.vendor_id, fromDate, toDate),
                TtDao.getReceiptsOnIncomeLabels(locationCode, vendor.vendor_id),
            ]);
            let balance = opening;
            const lines = rows.map(r => {
                balance = round2(balance + Number(r.debit) - Number(r.credit));
                return { ...r, balance };
            });
            const statement = {
                opening, lines, closing: balance,
                totalDebit: round2(rows.reduce((s, r) => s + Number(r.debit), 0)),
                totalCredit: round2(rows.reduce((s, r) => s + Number(r.credit), 0)),
                totalTds: round2(rows.reduce((s, r) => s + Number(r.tds), 0)),
                totalTaxable: round2(rows.reduce((s, r) => s + Number(r.taxable), 0)),
            };
            return res.render('tt/home', { ...data, statement, oldLabelReceipts, receiptLabel: TtDao.receiptLabel(vendor.oil_company) });
        }

        const deletedInvoices = await TtDao.getDeletedInvoices(locationCode);
        return res.render('tt/home', { ...data, deletedInvoices });
    } catch (e) {
        next(e);
    }
}

module.exports = {
    getPage: (req, res, next) => renderPage(req, res, next, 'bills'),
    getMasterPage: (req, res, next) => renderPage(req, res, next, 'master'),

    // POST /tt/api/upload/preview (multipart file) -> what would be saved
    previewUpload: async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ success: false, error: 'Choose the freight bill PDF.' });
            const r = await TtService.buildFromPdf(req.user.location_code, req.file.buffer, req.file.originalname);
            res.json({
                success: true,
                header: r.header,
                vendor: r.vendor ? { vendor_code: r.vendor.vendor_code, vendor_name: r.vendor.vendor_name, tds_percent: r.vendor.tds_percent } : null,
                errors: r.errors,
                warnings: r.warnings,
                bills: r.bills.map(b => {
                    const { lines, ...rest } = b;
                    return { ...rest, bill_date_display: fmtDate(b.bill_date), period: `${fmtDate(b.period_from)} to ${fmtDate(b.period_to)}`,
                        trips: lines.map(l => ({ sno: l.sno, vehicle_no: l.vehicle_no, delivery_invoice_no: l.delivery_invoice_no,
                            delivery_date: fmtDate(l.delivery_date), ship_to: `${l.ship_to_code || ''} ${l.ship_to_name || ''}`.trim(),
                            material_code: l.material_code, qty_kl: l.qty_kl, km: l.rtd_p + l.rtd_h + l.rtd_hh, gross_amount: l.gross_amount })) };
                }),
            });
        } catch (e) {
            console.error('TT previewUpload:', e);
            res.status(400).json({ success: false, error: e.message || 'Could not read the file.' });
        }
    },

    // POST /tt/api/upload (multipart file) -> saves the new bills in it
    saveUpload: async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ success: false, error: 'Choose the freight bill PDF.' });
            const r = await TtService.saveFromPdf(req.user.location_code, req.file.buffer, req.file.originalname, req.user.User_Name);
            res.json({ success: true, ...r });
        } catch (e) {
            console.error('TT saveUpload:', e);
            const dup = e.parent && e.parent.code === 'ER_DUP_ENTRY';
            res.status(400).json({ success: false, error: dup ? 'One of these bills was saved a moment ago. Reload the page.' : (e.message || 'Could not save the bills.') });
        }
    },

    // GET /tt/api/invoices/:id -> bill with its trips
    getInvoice: async (req, res) => {
        try {
            const inv = await TtDao.getInvoice(req.user.location_code, Number(req.params.id));
            if (!inv) return res.status(404).json({ success: false, error: 'Bill not found.' });
            inv.bill_date_display = fmtDate(inv.bill_date);
            inv.period = `${fmtDate(inv.period_from)} to ${fmtDate(inv.period_to)}`;
            inv.generated_on_display = fmtDate(inv.generated_on);
            inv.lines.forEach(l => { l.delivery_date_display = fmtDate(l.delivery_date); });
            res.json({ success: true, invoice: inv });
        } catch (e) {
            console.error('TT getInvoice:', e);
            res.status(500).json({ success: false, error: 'Could not load the bill.' });
        }
    },

    // POST /tt/api/invoices/:id/delete { reason }
    deleteInvoice: async (req, res) => {
        try {
            const reason = clean(req.body.reason);
            if (!reason) return res.status(400).json({ success: false, error: 'Give a reason for deleting the bill.' });
            const ok = await TtDao.deleteInvoice(req.user.location_code, Number(req.params.id), reason.substring(0, 300), req.user.User_Name);
            if (!ok) return res.status(404).json({ success: false, error: 'Bill not found.' });
            res.json({ success: true });
        } catch (e) {
            console.error('TT deleteInvoice:', e);
            res.status(500).json({ success: false, error: 'Could not delete the bill.' });
        }
    },

    // POST /tt/api/advice/preview (multipart file) -> what the BPCL payment advice holds
    previewAdvice: async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ success: false, error: 'Choose the payment advice Excel file.' });
            const r = await TtService.buildAdviceFromExcel(req.user.location_code, req.file.buffer);
            res.json({
                success: true, status: r.status, errors: r.errors, warnings: r.warnings, totals: r.totals, checks: r.checks,
                header: { ...r.header, clearing_date_display: fmtDate(r.header.clearing_date) },
                lines: r.lines.map(l => ({ ...l, date: fmtDate(l.txn_date) })),
            });
        } catch (e) {
            console.error('TT previewAdvice:', e);
            res.status(400).json({ success: false, error: e.message || 'Could not read the file.' });
        }
    },

    // POST /tt/api/advice (multipart file) -> saves the payment advice
    saveAdvice: async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ success: false, error: 'Choose the payment advice Excel file.' });
            const r = await TtService.saveAdviceFromExcel(req.user.location_code, req.file.buffer, req.file.originalname, req.user.User_Name);
            res.json({ success: true, ...r });
        } catch (e) {
            console.error('TT saveAdvice:', e);
            const dup = e.parent && e.parent.code === 'ER_DUP_ENTRY';
            res.status(400).json({ success: false, error: dup ? 'This payment was saved a moment ago. Reload the page.' : (e.message || 'Could not save the payment advice.') });
        }
    },

    // GET /tt/api/advice/:id -> advice with its lines
    getAdvice: async (req, res) => {
        try {
            const a = await TtDao.getAdvice(req.user.location_code, Number(req.params.id));
            if (!a) return res.status(404).json({ success: false, error: 'Payment advice not found.' });
            a.clearing_date_display = fmtDate(a.clearing_date);
            a.lines.forEach(l => { l.date = fmtDate(l.txn_date); });
            res.json({ success: true, advice: a });
        } catch (e) {
            console.error('TT getAdvice:', e);
            res.status(500).json({ success: false, error: 'Could not load the payment advice.' });
        }
    },

    // DELETE /tt/api/advice/:id — register only (no GL), so a plain delete
    deleteAdvice: async (req, res) => {
        try {
            const ok = await TtDao.deleteAdvice(req.user.location_code, Number(req.params.id));
            if (!ok) return res.status(404).json({ success: false, error: 'Payment advice not found.' });
            res.json({ success: true });
        } catch (e) {
            console.error('TT deleteAdvice:', e);
            res.status(500).json({ success: false, error: 'Could not delete the payment advice.' });
        }
    },

    // POST /tt/api/card/preview (multipart file) -> what the XTRAPOWER / SmartFleet statement holds
    previewCard: async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ success: false, error: 'Choose the fleet card statement PDF.' });
            const r = await TtService.buildCardFromPdf(req.user.location_code, req.file.buffer);
            const s = r.summary;
            const sum = (k) => round2(r.txns.filter(t => t.kind === k).reduce((a, t) => a + t.rupees, 0));
            // loyalty: points added up first, then converted once (as Create Accounting books it)
            const ppr = (r.card && Number(r.card.points_per_rupee)) || 100;
            const pts = (k) => round2(r.txns.filter(t => t.kind === k).reduce((a, t) => a + t.amount, 0) / ppr);
            res.json({
                success: true, status: r.status, errors: r.errors, warnings: r.warnings,
                summary: { program: s.program, customer_id: s.customer_id, customer_name: s.customer_name, period: `${fmtDate(s.period_from)} to ${fmtDate(s.period_to)}`,
                    ccms: s.ccms, loyalty: s.loyalty },
                booked: { recharge: sum('RECHARGE'), diesel: round2(sum('SALE') + sum('SALE_COMPLETE') - sum('REVERSAL')),
                    pointsToCard: sum('POINTS_TO_CARD'), loyalty: pts('LOYALTY_AWARD'), loyaltyTds: pts('LOYALTY_TDS') },
                txns: r.txns.map(t => ({ sno: t.sno, kind: t.kind, date: fmtDate(t.txn_date), merchant: t.merchant, vehicle_no: t.vehicle_no || t.card_name || null,
                    product: t.product, currency: t.currency, amount: t.amount, rupees: t.rupees, balance: t.balance, ref: t.txn_ref,
                    points: t.points, advice: t.advice ? `${t.advice.clearing_doc_no} (${fmtDate(t.advice.clearing_date)})` : null,
                    advice_pending: s.program === 'SMARTFLEET' && t.kind === 'RECHARGE' && !t.advice })),
            });
        } catch (e) {
            console.error('TT previewCard:', e);
            res.status(400).json({ success: false, error: e.message || 'Could not read the file.' });
        }
    },

    // POST /tt/api/card (multipart file) -> saves the statement
    saveCard: async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ success: false, error: 'Choose the fleet card statement PDF.' });
            const r = await TtService.saveCardFromPdf(req.user.location_code, req.file.buffer, req.file.originalname, req.user.User_Name);
            res.json({ success: true, ...r });
        } catch (e) {
            console.error('TT saveCard:', e);
            const dup = e.parent && e.parent.code === 'ER_DUP_ENTRY';
            res.status(400).json({ success: false, error: dup ? 'This statement was saved a moment ago. Reload the page.' : (e.message || 'Could not save the statement.') });
        }
    },

    // GET /tt/api/card/:id -> statement with its transactions
    getCardStatement: async (req, res) => {
        try {
            const s = await TtDao.getCardStatement(req.user.location_code, Number(req.params.id));
            if (!s) return res.status(404).json({ success: false, error: 'Statement not found.' });
            s.period = `${fmtDate(s.period_from)} to ${fmtDate(s.period_to)}`;
            s.txns.forEach(t => { t.date = fmtDate(t.txn_date); });
            // SmartFleet: which BPCL payment each recharge came out of
            const card = s.program === 'SMARTFLEET' ? await TtDao.getCard(req.user.location_code, s.card_id) : null;
            const recharges = s.txns.filter(t => t.kind === 'RECHARGE');
            if (card && card.vendor_id && recharges.length) {
                const iso = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
                const shift = (d, n) => new Date(Date.parse(iso(d)) + n * 86400000).toISOString().slice(0, 10);
                const lines = await TtDao.getAdviceFleetLines(req.user.location_code, card.vendor_id, shift(s.period_from, -3), shift(s.period_to, 3));
                const hit = TtService.matchCardRecharges(lines.map(l => ({ ...l, key: l.line_id })),
                    recharges.map(t => ({ ...t, txn_date: iso(t.txn_date) })));
                hit.forEach((r, lineId) => {
                    const l = lines.find(x => x.line_id === lineId);
                    const t = recharges.find(x => x.txn_id === r.txn_id);
                    if (t && l) t.advice = `${l.clearing_doc_no} (${fmtDate(l.clearing_date)})`;
                });
                recharges.forEach(t => { t.advice_pending = !t.advice; });
            }
            res.json({ success: true, statement: s });
        } catch (e) {
            console.error('TT getCardStatement:', e);
            res.status(500).json({ success: false, error: 'Could not load the statement.' });
        }
    },

    // DELETE /tt/api/card/:id
    deleteCardStatement: async (req, res) => {
        try {
            const ok = await TtDao.deleteCardStatement(req.user.location_code, Number(req.params.id), req.user.User_Name);
            if (!ok) return res.status(404).json({ success: false, error: 'Statement not found.' });
            res.json({ success: true });
        } catch (e) {
            console.error('TT deleteCardStatement:', e);
            res.status(500).json({ success: false, error: 'Could not delete the statement.' });
        }
    },

    // PUT /tt/api/cards/:id — fleet card settings
    saveCardSettings: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const cardId = Number(req.params.id);
            const existing = await TtDao.getCard(locationCode, cardId);
            if (!existing) return res.status(404).json({ success: false, error: 'Card not found.' });
            // SmartFleet Petromiles are not booked (value not known), so its loyalty ledgers are optional
            const loyaltyOptional = existing.program === 'SMARTFLEET';
            const b = req.body;
            const id = (v) => (v ? Number(v) : null);
            const d = {
                customer_name: clean(b.customer_name), vendor_id: id(b.vendor_id), vehicle_id: id(b.vehicle_id),
                wallet_ledger_id: id(b.wallet_ledger_id), points_ledger_id: id(b.points_ledger_id), diesel_ledger_id: id(b.diesel_ledger_id),
                loyalty_income_ledger_id: id(b.loyalty_income_ledger_id), tds_ledger_id: id(b.tds_ledger_id),
                start_date: clean(b.start_date), active_flag: b.active_flag === 'N' ? 'N' : 'Y',
            };
            if (!isIsoDate(d.start_date)) return res.status(400).json({ success: false, error: 'Start date is required.' });
            if (!d.vendor_id) return res.status(400).json({ success: false, error: 'Link the card to the oil company vendor whose freight is paid onto it.' });
            const [ledgers, expenses] = await Promise.all([TtDao.getLedgerChoices(locationCode), TtDao.getExpenseLedgers(locationCode)]);
            const kindOf = (lid) => (ledgers.find(l => l.ledger_id === lid) || {}).kind;
            if (kindOf(d.wallet_ledger_id) !== 'asset') return res.status(400).json({ success: false, error: 'Card ledger must be an asset ledger.' });
            if ((!loyaltyOptional || d.points_ledger_id) && kindOf(d.points_ledger_id) !== 'asset') return res.status(400).json({ success: false, error: 'Loyalty points ledger must be an asset ledger.' });
            if ((!loyaltyOptional || d.loyalty_income_ledger_id) && kindOf(d.loyalty_income_ledger_id) !== 'income') return res.status(400).json({ success: false, error: 'Loyalty income ledger must be an income ledger.' });
            if (d.tds_ledger_id && kindOf(d.tds_ledger_id) !== 'asset') return res.status(400).json({ success: false, error: 'TDS ledger must be an asset ledger (e.g. TDS RECEIVABLE).' });
            if (!expenses.some(l => l.ledger_id === d.diesel_ledger_id)) return res.status(400).json({ success: false, error: 'Diesel ledger must be an expense ledger of this location.' });
            if (d.vendor_id && !(await TtDao.getVendor(locationCode, d.vendor_id))) return res.status(400).json({ success: false, error: 'Vendor not found.' });
            await TtDao.updateCard(locationCode, cardId, d, req.user.User_Name);
            res.json({ success: true });
        } catch (e) {
            console.error('TT saveCardSettings:', e);
            res.status(500).json({ success: false, error: 'Could not save the card.' });
        }
    },

    // PUT /tt/api/vendors/:id
    saveVendor: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const vendorId = Number(req.params.id);
            const vendor = await TtDao.getVendor(locationCode, vendorId);
            if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found.' });
            const v = validateVendor(req.body);
            if (v.error) return res.status(400).json({ success: false, error: v.error });
            const [ledgers, banks] = await Promise.all([TtDao.getLedgerChoices(locationCode), TtDao.getBanks(locationCode)]);
            const kindOf = (id) => (ledgers.find(l => l.ledger_id === id) || {}).kind;
            if (kindOf(v.data.debtor_ledger_id) !== 'debtor') return res.status(400).json({ success: false, error: 'Debtor ledger must be a Sundry Debtors ledger of this location.' });
            if (kindOf(v.data.income_ledger_id) !== 'income') return res.status(400).json({ success: false, error: 'Income ledger must be an income ledger of this location.' });
            if (v.data.tds_ledger_id && kindOf(v.data.tds_ledger_id) !== 'asset') return res.status(400).json({ success: false, error: 'TDS ledger must be an asset ledger of this location (e.g. TDS RECEIVABLE).' });
            if (v.data.receipt_bank_id && !banks.some(b => b.bank_id === v.data.receipt_bank_id)) {
                return res.status(400).json({ success: false, error: 'Receipt bank is not an active bank of this location.' });
            }
            await TtDao.updateVendor(locationCode, vendorId, v.data, req.user.User_Name);
            res.json({ success: true });
        } catch (e) {
            console.error('TT saveVendor:', e);
            res.status(500).json({ success: false, error: 'Could not save the vendor.' });
        }
    },

    // POST /tt/api/vehicles, PUT /tt/api/vehicles/:id
    saveVehicle: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const vehicleId = req.params.id ? Number(req.params.id) : null;
            if (vehicleId && !(await TtDao.getVehicle(locationCode, vehicleId))) {
                return res.status(404).json({ success: false, error: 'Truck not found.' });
            }
            const v = validateVehicle(req.body);
            if (v.error) return res.status(400).json({ success: false, error: v.error });
            if (await TtDao.vehicleNoExists(locationCode, v.data.vehicle_no, vehicleId)) {
                return res.status(400).json({ success: false, error: `Truck ${v.data.vehicle_no} already exists.` });
            }
            if (v.data.vendor_id && !(await TtDao.getVendor(locationCode, v.data.vendor_id))) {
                return res.status(400).json({ success: false, error: 'Vendor not found.' });
            }
            const id = await TtDao.saveVehicle(locationCode, vehicleId, v.data, req.user.User_Name);
            res.json({ success: true, vehicle_id: id });
        } catch (e) {
            console.error('TT saveVehicle:', e);
            res.status(500).json({ success: false, error: 'Could not save the truck.' });
        }
    },

    // DELETE /tt/api/vehicles/:id — only a truck with no trips on any bill
    deleteVehicle: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const vehicles = await TtDao.getVehicles(locationCode);
            const v = vehicles.find(x => x.vehicle_id === Number(req.params.id));
            if (!v) return res.status(404).json({ success: false, error: 'Truck not found.' });
            if (Number(v.trip_count) > 0) return res.status(400).json({ success: false, error: 'This truck has trips on freight bills. Mark it inactive instead.' });
            await TtDao.deleteVehicle(locationCode, v.vehicle_id);
            res.json({ success: true });
        } catch (e) {
            console.error('TT deleteVehicle:', e);
            res.status(500).json({ success: false, error: 'Could not delete the truck.' });
        }
    },
};
