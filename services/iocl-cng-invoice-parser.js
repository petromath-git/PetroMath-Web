// services/iocl-cng-invoice-parser.js — IOCL CNG tax invoice (tkt #481).
//
// IOCL bills CNG to the dealer as a VAT invoice, one per day: one line of "COMPRESSED NATURAL GAS" in KG
// at a base price per KG, plus A/R VAT 5%, TCS 0% and a rounding difference. Two layouts are in use
// (Apr–Sep 2026 "TAX INVOICE" and from Oct 2026 "Tax Invoice"); pdf-parse orders their text differently,
// so this reads the whole text with regexes instead of the line-config parser used for MS/HSD.
// There is no buyer GSTIN on these invoices: the bunk is proved by the IOCL customer code
// (the same number that ends the bunk's IOCL SAP account, e.g. 30210428604A173621 -> 173621).
const moment = require('moment');

const PRODUCT_NAME = 'COMPRESSED NATURAL GAS';

function isIoclCngText(text) {
    const t = String(text || '');
    return /COMPRESSED NATURAL GAS/i.test(t) && /INDIAN\s*OIL CORPORATION/i.test(t) && /Base Price/i.test(t);
}

const num = s => (s == null ? null : parseFloat(String(s).replace(/,/g, '')));
const amt = (s, minus) => { const n = num(s); return n == null ? null : (minus ? -n : n); };
const r2 = n => Math.round(n * 100) / 100;

// Returns { header, line, customer_code, check } or throws an Error with a reason a person can act on.
function parseIoclCngText(rawText) {
    const t = String(rawText || '').replace(/\s+/g, ' ');
    if (!isIoclCngText(t)) throw new Error('Not an IOCL CNG invoice.');

    let m;
    // old layout: "7007646894Invoice No.:" — new layout: "Invoice No. :7011694021"
    const invoiceNo = ((m = /(\d{10})\s*Invoice No\.\s*:/i.exec(t)) || (m = /Invoice No\.\s*:\s*(\d{10})/i.exec(t))) ? m[1] : null;
    const dateRaw = (m = /([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/.exec(t)) ? m[1] : null;
    const date = dateRaw ? moment(dateRaw.replace(/\s+/g, ' '), ['MMM D, YYYY', 'MMMM D, YYYY'], 'en') : null;
    const customer = ((m = /(\d{6,8})\s*Code\s*:/i.exec(t)) || (m = /Code\s*:\s*(\d{6,8})/i.exec(t))) ? m[1] : null;
    const assignment = ((m = /([0-9A-Z]{12,20})\s*Assignment\s*:/i.exec(t)) || (m = /Assignment\s*:\s*([0-9A-Z]{12,20})/i.exec(t))) ? m[1] : null;

    const qty = (m = /COMPRESSED NATURAL GAS[^]*?([\d,]+\.\d{3})\s*KG/i.exec(t)) ? num(m[1]) : null;
    const hsn = (m = /HSN Code:\s*([\d ]{4,12}?)\s*\)/i.exec(t)) ? m[1].replace(/\s+/g, '') : null;
    const base = /Base Price \( per\s*1 KG \)\s*([\d,]+\.\d+)\s*INR\s*([\d,]+\.\d{2})/i.exec(t);
    const vat = /A\/R Vat Payable\s*([\d.]+)\s*%\s*([\d,]+\.\d{2})(-?)/i.exec(t);
    const tcs = /TCS u\/s 206C\(1H\)\s*([\d.]+)\s*%\s*([\d,]+\.\d{2})(-?)/i.exec(t);
    const rnd = /Rounding Difference\s*100\s*%\s*([\d,]+\.\d{2})(-?)/i.exec(t);
    const total = (m = /Total Invoice Amount:\s*INR\s*([\d,]+\.\d{2})/i.exec(t)) ? num(m[1]) : null;

    const missing = [];
    if (!invoiceNo) missing.push('invoice number');
    if (!date || !date.isValid()) missing.push('date');
    if (!(qty > 0)) missing.push('quantity (KG)');
    if (!base) missing.push('base price');
    if (total == null) missing.push('total');
    if (missing.length) throw new Error(`Could not read the ${missing.join(', ')} from this IOCL CNG invoice.`);

    const rate = num(base[1]);
    const basic = num(base[2]);
    const charges = [];
    if (vat) charges.push({ charge_type: 'VAT', charge_pct: num(vat[1]), charge_amount: amt(vat[2], vat[3]) });
    if (tcs && num(tcs[2]) !== 0) charges.push({ charge_type: 'TCS', charge_pct: num(tcs[1]), charge_amount: amt(tcs[2], tcs[3]) });
    if (rnd && num(rnd[1]) !== 0) charges.push({ charge_type: 'ROUNDING', charge_pct: null, charge_amount: amt(rnd[1], rnd[2]) });

    // The parts must make the printed total, else a field was misread: never save a wrong amount.
    const sum = r2(basic + charges.reduce((s, c) => s + (c.charge_amount || 0), 0));
    if (Math.abs(sum - total) > 0.05) {
        throw new Error(`Invoice ${invoiceNo}: base ${basic} + charges = ${sum}, but the invoice total is ${total}. Enter it by hand.`);
    }
    if (Math.abs(r2(qty * rate) - basic) > 1) {
        throw new Error(`Invoice ${invoiceNo}: ${qty} KG x ${rate} is not the base amount ${basic}. Enter it by hand.`);
    }

    return {
        customer_code: customer,
        header: {
            invoice_number: invoiceNo,
            invoice_date: date.format('YYYY-MM-DD'),
            delivery_doc_no: assignment,
            total_invoice_amount: total,
        },
        line: {
            product_name: PRODUCT_NAME,
            quantity: qty,
            qty_unit: 'KG',
            rate_per_kl: rate,          // per KG for CNG (the column is named for MS/HSD)
            hsn_code: hsn,
            total_line_amount: basic,
            charges,
        },
    };
}

module.exports = { isIoclCngText, parseIoclCngText, PRODUCT_NAME };
