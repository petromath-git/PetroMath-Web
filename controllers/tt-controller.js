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
    bills:  { title: 'Tank Truck Freight', basePath: '/tt', tabs: [['bills', 'Freight Bills'], ['statement', 'Statement'], ['deleted', 'Deleted']] },
    master: { title: 'Tank Truck Master', basePath: '/tt/master', tabs: [['vendors', 'Oil Company Vendor'], ['trucks', 'Trucks']] },
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

        const tab = page.tabs.some(t => t[0] === req.query.tab) ? req.query.tab : page.tabs[0][0];
        const fy = fyRange(isIsoDate(req.query.from) ? new Date(req.query.from) : new Date());
        const fromDate = isIsoDate(req.query.from) ? req.query.from : fy.from;
        const toDate = isIsoDate(req.query.to) ? req.query.to : fy.to;
        const vendor = vendors.find(v => v.vendor_id === Number(req.query.vendor)) || vendors.find(v => v.active_flag === 'Y') || vendors[0];
        const data = { ...common, tab, vendors, vendor, fromDate, toDate };

        if (pageKey === 'master') {
            const [vehicles, ledgers, banks] = await Promise.all([
                TtDao.getVehicles(locationCode), TtDao.getLedgerChoices(locationCode), TtDao.getBanks(locationCode),
            ]);
            return res.render('tt/home', { ...data, vehicles, ledgers, banks });
        }

        if (tab === 'bills') {
            const [bills, oldLabelReceipts] = await Promise.all([
                TtDao.getInvoices(locationCode, fromDate, toDate),
                TtDao.getReceiptsOnIncomeLabels(locationCode, vendor.vendor_id),
            ]);
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
                m.tds += Number(b.tds_amount); m.net += Number(b.net_receivable); m.trips += Number(b.trip_count); m.kl += Number(b.total_kl);
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
