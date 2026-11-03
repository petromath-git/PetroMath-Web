// services/tt-service.js — Tank Truck Freight: turns an uploaded freight-bill PDF into bills to save.
// Preview and save run the same checks on the same file, so nothing is kept between the two.
//
// Amounts per bill (vendor settings give the GST rate and TDS %):
//   taxable        = gross - penalty
//   CGST / SGST    = taxable x rate / 2 each (IGST if the bill printed IGST), rounded to paise:
//                    what GSTR-1 reports. The bill's own figures (sum of per-trip rounding,
//                    a few paise off) are kept as bill_cgst / bill_sgst.
//   TDS            = taxable x TDS %, rounded to the rupee (as IOCL deducts it)
//   net receivable = taxable - TDS (GST is paid by the oil company under reverse charge)
const TtDao = require('../dao/tt-dao');
const GstConfigDao = require('../dao/gst-config-dao');
const { parseIoclTransportBill } = require('./tt-invoice-parser');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function computeAmounts(totals, gstRate, tdsPercent) {
    const taxable = r2(totals.gross - totals.penalty);
    const interstate = totals.igst > 0 && totals.cgst === 0;
    const igst = interstate ? r2(taxable * gstRate / 100) : 0;
    const half = interstate ? 0 : r2(taxable * gstRate / 200);
    const tds = Math.round(taxable * tdsPercent / 100);
    return {
        gross_amount: r2(totals.gross),
        penalty_amount: r2(totals.penalty),
        taxable_value: taxable,
        cgst_amount: half,
        sgst_amount: half,
        igst_amount: igst,
        bill_cgst: r2(totals.cgst),
        bill_sgst: r2(totals.sgst),
        bill_igst: r2(totals.igst),
        invoice_value: r2(taxable + half * 2 + igst),
        tds_percent: tdsPercent,
        tds_amount: tds,
        net_receivable: r2(taxable - tds)
    };
}

// Returns { header, vendor, bills: [{ ...row, lines, status, problems[] }], errors[], warnings[] }.
// status: NEW (will be saved), EXISTS (already uploaded), BEFORE_START (dated before the vendor's
// start date), BLOCKED (see problems). Throws only when the file can't be read at all.
async function buildFromPdf(locationCode, buffer, fileName) {
    const parsed = await parseIoclTransportBill(buffer);
    const h = parsed.header;
    const errors = [];
    const warnings = parsed.warnings.slice();

    const gstConfig = await GstConfigDao.findByLocationCode(locationCode);
    const ownGstin = gstConfig ? String(gstConfig.gstin || '').trim().toUpperCase() : '';
    if (!ownGstin) {
        errors.push('This location has no GSTIN set up (GST Returns > Settings), so the bill cannot be checked against it.');
    } else if (h.vendor_gstin !== ownGstin) {
        errors.push(`The bill is issued by GSTIN ${h.vendor_gstin} (${h.vendor_name || 'unknown'}), but this location's GSTIN is ${ownGstin}. Upload it at the location it belongs to.`);
    }

    const vendor = h.vendor_code ? await TtDao.getVendorByCode(locationCode, parsed.oil_company, h.vendor_code) : null;
    if (!vendor) {
        errors.push(`No active ${parsed.oil_company} transporter with vendor code ${h.vendor_code || '(none)'} is set up for ${locationCode}. Add it in Masters > Tank Truck Master.`);
    } else {
        if (!vendor.debtor_ledger_id || !vendor.income_ledger_id) warnings.push('The vendor has no debtor or income ledger set, so Create Accounting will fail on these bills until they are set in Tank Truck Master.');
        if (!vendor.tds_ledger_id && Number(vendor.tds_percent) > 0) warnings.push('The vendor has no TDS ledger set in Tank Truck Master.');
    }

    const existing = await TtDao.getExistingBillNos(locationCode, parsed.bills.map(b => b.bill_no));
    const startDate = vendor ? String(vendor.start_date instanceof Date ? vendor.start_date.toISOString().slice(0, 10) : vendor.start_date).slice(0, 10) : null;

    const bills = parsed.bills.map(b => {
        const amounts = computeAmounts(b.totals, vendor ? Number(vendor.gst_rate) : 5, vendor ? Number(vendor.tds_percent) : 0);
        const problems = [];
        let status = 'NEW';
        if (existing.has(b.bill_no)) status = 'EXISTS';
        else if (startDate && b.bill_date < startDate) status = 'BEFORE_START';
        if (b.bill_no.length > 16) problems.push(`Bill number ${b.bill_no} is longer than 16 characters; the GST portal will not take it.`);
        if (!h.recipient_gstin) problems.push('Recipient (IOCL terminal) GSTIN not found on the bill.');
        if (Math.abs(amounts.bill_cgst - amounts.cgst_amount) > 1 || Math.abs(amounts.bill_sgst - amounts.sgst_amount) > 1) {
            warnings.push(`Bill ${b.bill_no}: GST printed (${amounts.bill_cgst} + ${amounts.bill_sgst}) differs by more than ₹1 from ${vendor ? vendor.gst_rate : 5}% of the taxable value (${amounts.cgst_amount} + ${amounts.sgst_amount}). Check the GST rate in Tank Truck Master.`);
        }
        if (problems.length && status === 'NEW') status = 'BLOCKED';
        const vehicles = Array.from(new Set(b.lines.map(l => l.vehicle_no)));
        return {
            vendor_id: vendor ? vendor.vendor_id : null,
            bill_no: b.bill_no,
            bill_date: b.bill_date,
            period_from: h.period_from,
            period_to: h.period_to,
            generated_on: h.generated_on,
            reverse_charge: b.reverse_charge,
            recipient_name: h.recipient_name,
            recipient_gstin: h.recipient_gstin,
            recipient_address: h.recipient_address,
            sac_code: vendor ? vendor.sac_code : '996791',
            gst_rate: vendor ? Number(vendor.gst_rate) : 5,
            ...amounts,
            trip_count: b.lines.length,
            total_kl: Math.round(b.lines.reduce((s, l) => s + l.qty_kl, 0) * 1000) / 1000,
            vehicles: vehicles.join(', ').substring(0, 200),
            file_name: fileName ? String(fileName).substring(0, 200) : null,
            lines: b.lines,
            status,
            problems
        };
    });

    return { header: h, oil_company: parsed.oil_company, vendor, bills, errors, warnings };
}

// Saves the NEW bills of the file. Returns { saved: [bill_no], skipped: [{ bill_no, reason }] }.
async function saveFromPdf(locationCode, buffer, fileName, by) {
    const r = await buildFromPdf(locationCode, buffer, fileName);
    if (r.errors.length) {
        const e = new Error(r.errors.join(' '));
        e.userFacing = true;
        throw e;
    }
    const toSave = r.bills.filter(b => b.status === 'NEW');
    const skipped = r.bills.filter(b => b.status !== 'NEW').map(b => ({
        bill_no: b.bill_no,
        reason: b.status === 'EXISTS' ? 'already uploaded'
            : b.status === 'BEFORE_START' ? 'dated before the start date'
            : b.problems.join(' ')
    }));
    if (toSave.length) await TtDao.createInvoices(locationCode, toSave, by);
    return { saved: toSave.map(b => b.bill_no), skipped };
}

module.exports = { buildFromPdf, saveFromPdf, computeAmounts };
