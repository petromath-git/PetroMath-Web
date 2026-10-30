// GSTR-3B worksheet: every box to type on the portal for a month, and how the tax is
// paid (credit ledger first, then cash). Nothing is uploaded; the portal fills 3.1 from
// GSTR-1 and 4A from GSTR-2B, and these figures are what to check them against.
//
//   3.1(a)/(c)/(e)  sales, from the GSTR-1 build (same figures as the GST Summary)
//   3.1(d), 4A(3)   reverse charge: /gst/rcm self-invoices + 2B lines marked reverse charge
//   4A(5), 4B(1)    GSTR-2B credit and the Rule 42 / 17(5) reversal (/gst/itc)
//   5               petrol / diesel bought (non-GST inward), before VAT as the auditor has filed
//                   since May-2026 (FY25-26 returns used the invoice value with VAT; both shown)
//   6.1             liability rounded to the rupee as the portal shows it, paid from the
//                   credit ledger (IGST credit first, CGST and SGST never cross) then cash.
//                   Reverse charge, interest and late fee are cash only.
const moment = require('moment');
const Gstr1ReturnService = require('./gstr1-return-service');
const GstItcService = require('./gst-itc-service');
const GstFilingDao = require('../dao/gst-filing-dao');
const gstUtils = require('../utils/gst-utils');

const HEADS = ['igst', 'cgst', 'sgst'];
const r2 = (n) => Math.round((parseFloat(n || 0) + Number.EPSILON) * 100) / 100;
const num = (n) => parseFloat(n || 0);

// Credit ledger use under Rule 88A: IGST credit first (IGST, then CGST, then SGST),
// then CGST credit (CGST, then IGST), then SGST credit (SGST, then IGST).
function setOff(liability, credit) {
    const due = Object.assign({}, liability);
    const left = Object.assign({}, credit);
    const paid = Object.fromEntries(HEADS.map(h => [h, { igst: 0, cgst: 0, sgst: 0 }]));   // paid[liabilityHead][creditHead]
    const use = (from, to) => {
        const amt = Math.max(0, Math.min(left[from], due[to]));
        left[from] = r2(left[from] - amt); due[to] = r2(due[to] - amt); paid[to][from] = r2(paid[to][from] + amt);
    };
    use('igst', 'igst'); use('igst', 'cgst'); use('igst', 'sgst');
    use('cgst', 'cgst'); use('cgst', 'igst');
    use('sgst', 'sgst'); use('sgst', 'igst');
    return { paid, cash: due, closing: left };
}

// Credit ledger balance brought forward: this month's saved figure, else last month's
// saved closing balance, else zero (enter it from the portal's Electronic Credit Ledger).
async function openingBalance(locationCode, returnPeriod) {
    const row = await GstFilingDao.getPeriod(locationCode, returnPeriod);
    if (row) return { row, source: 'saved' };
    const prev = await GstFilingDao.getPeriod(locationCode, gstUtils.getPreviousReturnPeriod(returnPeriod));
    if (prev && prev.ecl_close_cgst !== null) {
        return {
            row: { ecl_open_igst: prev.ecl_close_igst, ecl_open_cgst: prev.ecl_close_cgst, ecl_open_sgst: prev.ecl_close_sgst,
                   interest_cgst: 0, interest_sgst: 0, late_fee_cgst: 0, late_fee_sgst: 0, notes: '' },
            source: 'last month'
        };
    }
    return {
        row: { ecl_open_igst: 0, ecl_open_cgst: 0, ecl_open_sgst: 0, interest_cgst: 0, interest_sgst: 0, late_fee_cgst: 0, late_fee_sgst: 0, notes: '' },
        source: 'none'
    };
}

async function buildWorksheet(locationCode, returnPeriod, overrides) {
    const gstr1 = await Gstr1ReturnService.buildGstr1(locationCode, returnPeriod);
    const g = gstr1.gstr3b;
    const { from_date, to_date } = gstUtils.getPeriodDates(returnPeriod);
    const [itc, fuelPurchases, opening] = await Promise.all([
        GstItcService.buildItc(locationCode, returnPeriod, { taxable: g.outward.txval, exempt: g.nil + g.nonGst }),
        GstFilingDao.getFuelPurchases(locationCode, from_date, to_date),
        openingBalance(locationCode, returnPeriod)
    ]);
    const inputs = Object.assign({}, opening.row, overrides || {});
    HEADS.forEach(h => { inputs[`ecl_open_${h}`] = num(inputs[`ecl_open_${h}`]); });
    ['interest_cgst', 'interest_sgst', 'late_fee_cgst', 'late_fee_sgst'].forEach(k => { inputs[k] = num(inputs[k]); });

    const t31a = { txval: r2(g.outward.txval), igst: 0, cgst: r2(g.outward.camt), sgst: r2(g.outward.samt) };

    // 6.1 payment
    const liability = { igst: Math.round(t31a.igst), cgst: Math.round(t31a.cgst), sgst: Math.round(t31a.sgst) };
    const credit = {};
    HEADS.forEach(h => { credit[h] = r2(inputs[`ecl_open_${h}`] + itc.net[h]); });
    const payment = setOff(liability, credit);
    const rcmCash = { igst: Math.round(itc.rcmLiability.igst), cgst: Math.round(itc.rcmLiability.cgst), sgst: Math.round(itc.rcmLiability.sgst) };
    const interest = { igst: 0, cgst: inputs.interest_cgst, sgst: inputs.interest_sgst };
    const lateFee = { igst: 0, cgst: inputs.late_fee_cgst, sgst: inputs.late_fee_sgst };
    const cashTotal = HEADS.reduce((t, h) => t + payment.cash[h] + rcmCash[h] + interest[h] + lateFee[h], 0);

    const warnings = [];
    if (!gstr1.canDownload) warnings.push(`GSTR-1 for this month has ${gstr1.errors.length} error(s). Fix them on the GSTR-1 page first; 3.1 comes from it.`);
    if (!itc.uploaded) warnings.push('GSTR-2B is not uploaded for this month, so Table 4 shows only reverse charge. Upload it on the ITC page (the portal makes 2B on the 14th).');
    if (opening.source === 'none') warnings.push('Credit ledger balance brought forward is zero. If the portal\'s Electronic Credit Ledger shows a balance, enter it below.');
    itc.warnings.forEach(w => warnings.push(w));

    const fuelLine = fuelPurchases.reduce((t, f) => t + num(f.line_amount), 0);
    const fuelWithVat = fuelPurchases.reduce((t, f) => t + num(f.total_invoice_amount), 0);

    return {
        period: {
            code: returnPeriod,
            label: gstUtils.formatReturnPeriod(returnPeriod),
            due: moment(to_date).add(1, 'month').date(20).format('DD-MMM-YYYY')
        },
        gstin: gstr1.gstin,
        gstr1,
        itc,
        t31a,
        t31c: r2(g.nil),
        t31d: itc.rcmLiability,
        t31e: r2(g.nonGst),
        t5: { nonGst: r2(fuelLine), nonGstWithVat: r2(fuelWithVat), invoices: fuelPurchases },
        inputs,
        openingSource: opening.source,
        liability, credit, payment, rcmCash, interest, lateFee,
        cashTotal: r2(cashTotal),
        warnings
    };
}

// Saves the inputs and this month's closing credit balance, so next month starts from it.
async function saveWorksheet(locationCode, returnPeriod, body, user) {
    const overrides = {};
    ['ecl_open_igst', 'ecl_open_cgst', 'ecl_open_sgst', 'interest_cgst', 'interest_sgst', 'late_fee_cgst', 'late_fee_sgst']
        .forEach(k => { overrides[k] = r2(body[k]); });
    overrides.notes = String(body.notes || '').substring(0, 500);
    const w = await buildWorksheet(locationCode, returnPeriod, overrides);
    await GstFilingDao.savePeriod(Object.assign({}, overrides, {
        location_code: locationCode,
        return_period: returnPeriod,
        ecl_close_igst: w.payment.closing.igst,
        ecl_close_cgst: w.payment.closing.cgst,
        ecl_close_sgst: w.payment.closing.sgst,
        user
    }));
    return w;
}

module.exports = { buildWorksheet, saveWorksheet, setOff };
