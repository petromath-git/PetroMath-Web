// Input tax credit for GSTR-3B Table 4, from the GSTR-2B the portal generates each month
// (Returns > GSTR-2B > Download JSON) plus the reverse-charge self-invoices (/gst/rcm).
//
// Each 2B line gets a class, which decides how much credit is kept:
//   TAXABLE  used only for taxable sales (lubes, AdBlue, water)  -> full credit
//   COMMON   used for the whole outlet (oil company licence fee,
//            e-lock, rent, repairs)                                -> Rule 42 share
//   EXEMPT   used only for petrol / diesel                         -> no credit
//   BLOCKED  section 17(5) (food, personal, car, building works)   -> no credit
//
// Rule 42(1): common credit is reversed in the ratio of exempt turnover (petrol /
// diesel are non-GST supplies, which count as exempt) to total turnover of the month.
// The same rule asks for a true-up on the year's turnover by September of the next
// year; that is left to the annual return.
const moment = require('moment');
const XLSX = require('xlsx');
const GstFilingDao = require('../dao/gst-filing-dao');
const GstDataAggregationDao = require('../dao/gst-data-aggregation-dao');
const gstUtils = require('../utils/gst-utils');

const ITC_CLASSES = {
    TAXABLE: 'Taxable sales only (full credit)',
    COMMON: 'Common to the outlet (Rule 42 share)',
    EXEMPT: 'Petrol / diesel only (no credit)',
    BLOCKED: 'Blocked u/s 17(5) (no credit)'
};
const HEADS = ['igst', 'cgst', 'sgst'];

const r2 = (n) => Math.round((parseFloat(n || 0) + Number.EPSILON) * 100) / 100;
const num = (n) => parseFloat(n || 0);
const zero = () => ({ txval: 0, igst: 0, cgst: 0, sgst: 0 });
const addTo = (t, row, sign = 1) => {
    t.txval += sign * num(row.taxable_value);
    HEADS.forEach(h => { t[h] += sign * num(row[h]); });
    return t;
};
const round = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r2(v)]));
// Invoice numbers compared without spaces, slashes, dashes or leading zeros.
const normDoc = (no) => String(no || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');

// GSTR-2B Excel (portal: GSTR-2B > Download Excel) -> same rows as the JSON. Column
// positions are the portal's layout (Read me sheet holds GSTIN, year and month).
function parse2bExcel(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetRows = (name) => wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, raw: true }) : [];
    const isGstin = (v) => /^\d{2}[A-Z0-9]{13}$/.test(String(v || '').trim());
    const readMe = new Map(sheetRows('Read me').filter(r => r[0] && r[2]).map(r => [String(r[0]).trim(), String(r[2]).trim()]));
    const month = moment(readMe.get('Tax Period'), 'MMMM');
    const fyStart = parseInt(String(readMe.get('Financial Year') || '').substring(0, 4), 10);
    if (!month.isValid() || !fyStart) throw new Error('This Excel is not a GSTR-2B (no Tax Period / Financial Year on the Read me sheet).');
    const period = month.format('MM') + (month.month() >= 3 ? fyStart : fyStart + 1);
    const date = (v) => {
        if (v instanceof Date) return moment(v).format('YYYY-MM-DD');
        const m = moment(String(v || ''), ['DD/MM/YYYY', 'DD-MM-YYYY'], true);
        return m.isValid() ? m.format('YYYY-MM-DD') : null;
    };
    // "Sep'26" -> 092026
    const supPeriod = (v) => {
        const m = String(v || '').match(/^([A-Za-z]{3})'(\d{2})$/);
        const mon = m ? moment(m[1], 'MMM', true) : null;
        return mon && mon.isValid() ? mon.format('MM') + '20' + m[2] : null;
    };
    const yes = (v) => /^y/i.test(String(v || ''));
    const rows = [];
    // c = column of: gstin, name, doc no, doc type, date, rev charge, taxable, igst, cgst, sgst, cess, supplier period, ITC available, reason
    const take = (sheet, section, c, signOf) => sheetRows(sheet).filter(r => isGstin(r[c.gstin])).forEach(r => {
        const sign = signOf ? signOf(r) : 1;
        rows.push({
            section,
            supplier_gstin: String(r[c.gstin]).trim().toUpperCase(),
            supplier_name: r[c.name] || null,
            supplier_period: supPeriod(r[c.per]),
            doc_no: String(r[c.no] || '').substring(0, 30),
            doc_date: date(r[c.dt]),
            doc_type: section.startsWith('CDNR') ? (/credit/i.test(r[c.typ]) ? 'C' : 'D') : 'R',
            reverse_charge: yes(r[c.rev]) ? 'Y' : 'N',
            itc_available: c.avl !== undefined && /^n/i.test(String(r[c.avl] || '')) ? 'N' : 'Y',
            itc_reason: r[c.rsn] ? String(r[c.rsn]).substring(0, 100) : null,
            taxable_value: sign * num(r[c.tx]), igst: sign * num(r[c.ig]), cgst: sign * num(r[c.cg]), sgst: sign * num(r[c.sg]), cess: sign * num(r[c.ce])
        });
    });
    take('B2B', 'B2B', { gstin: 0, name: 1, no: 2, typ: 3, dt: 4, rev: 7, tx: 8, ig: 9, cg: 10, sg: 11, ce: 12, per: 13, avl: 15, rsn: 16 });
    take('B2BA', 'B2BA', { gstin: 2, name: 3, no: 4, typ: 5, dt: 6, rev: 9, tx: 10, ig: 11, cg: 12, sg: 13, ce: 14, per: 21, avl: 23, rsn: 24 });
    take('B2B-CDNR', 'CDNR', { gstin: 0, name: 1, no: 2, typ: 3, dt: 5, rev: 8, tx: 9, ig: 10, cg: 11, sg: 12, ce: 13, per: 20, avl: 22, rsn: 23 },
        (r) => /credit/i.test(r[3]) ? -1 : 1);
    const read = ['Read me', 'ITC Available', 'ITC not available', 'ITC Reversal', 'ITC Rejected', 'B2B', 'B2BA', 'B2B-CDNR'];
    const skipped = wb.SheetNames.filter(n => !read.includes(n) && !/rejected/i.test(n))
        .filter(n => sheetRows(n).some(r => r.slice(0, 4).some(isGstin)));
    return { gstin: String(readMe.get('GSTIN') || '').toUpperCase(), period, generated: readMe.get('Date of generation'), rows, skipped };
}

// GSTR-2B file -> flat rows. Takes the portal's JSON ({ data: {...} }) or its Excel download.
function parse2b(buffer) {
    if (buffer.slice(0, 2).toString() === 'PK') return parse2bExcel(buffer);
    let file;
    try {
        file = JSON.parse(buffer.toString('utf8').replace(/^﻿/, ''));
    } catch (e) {
        throw new Error('This is not a GSTR-2B file. On the portal use GSTR-2B > Download, as JSON or Excel.');
    }
    const data = file.data || file;
    if (!data.docdata || !data.rtnprd) {
        throw new Error('This JSON is not a GSTR-2B (no rtnprd / docdata). Download GSTR-2B, not GSTR-2A or GSTR-1.');
    }
    const rows = [];
    const skipped = [];
    const doc = data.docdata;
    const push = (section, sup, d, docNo, docType, sign) => rows.push({
        section,
        supplier_gstin: String(sup.ctin || '').toUpperCase(),
        supplier_name: sup.trdnm || null,
        supplier_period: sup.supprd || null,
        doc_no: String(docNo || '').substring(0, 30),
        doc_date: d.dt ? moment(d.dt, 'DD-MM-YYYY').format('YYYY-MM-DD') : null,
        doc_type: docType,
        reverse_charge: d.rev === 'Y' ? 'Y' : 'N',
        itc_available: d.itcavl === 'N' ? 'N' : 'Y',
        itc_reason: d.rsn || null,
        taxable_value: sign * num(d.txval),
        igst: sign * num(d.igst),
        cgst: sign * num(d.cgst),
        sgst: sign * num(d.sgst),
        cess: sign * num(d.cess)
    });
    (doc.b2b || []).forEach(s => (s.inv || []).forEach(d => push('B2B', s, d, d.inum, d.typ || 'R', 1)));
    (doc.b2ba || []).forEach(s => (s.inv || []).forEach(d => push('B2BA', s, d, d.inum, d.typ || 'R', 1)));
    // Credit notes reduce credit; debit notes add to it.
    (doc.cdnr || []).forEach(s => (s.nt || []).forEach(d => push('CDNR', s, d, d.ntnum, d.typ, d.typ === 'C' ? -1 : 1)));
    (doc.cdnra || []).forEach(s => (s.nt || []).forEach(d => push('CDNRA', s, d, d.ntnum, d.typ, d.typ === 'C' ? -1 : 1)));
    Object.keys(doc).filter(k => !['b2b', 'b2ba', 'cdnr', 'cdnra'].includes(k) && (doc[k] || []).length)
        .forEach(k => skipped.push(k.toUpperCase()));
    return { gstin: String(data.gstin || '').toUpperCase(), period: data.rtnprd, generated: data.gendt, rows, skipped };
}

// Lube purchase invoices in the books for the month and the month before (a supplier
// may file a late-month bill in the next 2B), one row per invoice.
async function purchaseBook(locationCode, returnPeriod) {
    const { from_date, to_date } = gstUtils.getPeriodDates(returnPeriod);
    const from = moment(from_date).subtract(1, 'month').format('YYYY-MM-DD');
    const lines = await GstDataAggregationDao.getPurchaseData(locationCode, from, to_date);
    const byInvoice = new Map();
    lines.forEach(l => {
        const key = `${String(l.supplier_gstin || '').toUpperCase()}|${normDoc(l.invoice_number)}`;
        if (!byInvoice.has(key)) {
            byInvoice.set(key, {
                key, supplier_gstin: String(l.supplier_gstin || '').toUpperCase(), supplier_name: l.supplier_name,
                invoice_number: l.invoice_number, invoice_date: l.invoice_date,
                inPeriod: moment(l.invoice_date).isSameOrAfter(from_date),
                taxable_value: 0, igst: 0, cgst: 0, sgst: 0
            });
        }
        const b = byInvoice.get(key);
        b.taxable_value += num(l.taxable_value); b.igst += num(l.igst_amount); b.cgst += num(l.cgst_amount); b.sgst += num(l.sgst_amount);
    });
    return Array.from(byInvoice.values());
}

function findInBook(book, row) {
    const no = normDoc(row.doc_no);
    return book.find(b => normDoc(b.invoice_number) === no && (!b.supplier_gstin || b.supplier_gstin === row.supplier_gstin));
}

async function upload2b(locationCode, returnPeriod, buffer, ownGstin, user) {
    const parsed = parse2b(buffer);
    if (ownGstin && parsed.gstin && parsed.gstin !== ownGstin) {
        throw new Error(`This 2B is for GSTIN ${parsed.gstin}, not ${ownGstin}.`);
    }
    if (parsed.period !== returnPeriod) {
        throw new Error(`This 2B is for ${gstUtils.formatReturnPeriod(parsed.period)}, but ${gstUtils.formatReturnPeriod(returnPeriod)} is open. Pick that month first.`);
    }
    const [supplierClasses, book] = await Promise.all([
        GstFilingDao.getSupplierClasses(locationCode),
        purchaseBook(locationCode, returnPeriod)
    ]);
    const supplierClass = new Map(supplierClasses.map(s => [s.supplier_gstin, s.itc_class]));
    // Class: the supplier's saved choice, else TAXABLE when the bill is in the lube
    // purchase book, else COMMON (shown for review).
    parsed.rows.forEach(r => {
        r.itc_class = supplierClass.get(r.supplier_gstin) || (findInBook(book, r) ? 'TAXABLE' : 'COMMON');
        r.class_source = 'AUTO';
    });
    await GstFilingDao.replace2bInvoices(locationCode, returnPeriod, parsed.rows, user);
    return parsed;
}

// Set one line's class and remember it for the supplier's future bills.
async function setClass(locationCode, gst2bId, itcClass, applyToSupplier, user) {
    if (!ITC_CLASSES[itcClass]) throw new Error('Unknown class');
    const row = await GstFilingDao.get2bInvoice(locationCode, gst2bId);
    if (!row) throw new Error('Line not found');
    await GstFilingDao.set2bClass(locationCode, gst2bId, itcClass);
    await GstFilingDao.saveSupplierClass(locationCode, row.supplier_gstin, itcClass, user);
    if (applyToSupplier) {
        const same = (await GstFilingDao.get2bInvoices(locationCode, row.return_period))
            .filter(r => r.supplier_gstin === row.supplier_gstin && r.class_source !== 'USER');
        for (const r of same) await GstFilingDao.set2bClass(locationCode, r.gst2b_id, itcClass);
    }
}

// turnover: { taxable, exempt } of the month, from the GSTR-1 build (3.1(a) and nil + non-GST).
async function buildItc(locationCode, returnPeriod, turnover) {
    const [rows, rcm, uploadInfo, book] = await Promise.all([
        GstFilingDao.get2bInvoices(locationCode, returnPeriod),
        GstFilingDao.getRcmEntries(locationCode, returnPeriod),
        GstFilingDao.get2bUploadInfo(locationCode, returnPeriod),
        purchaseBook(locationCode, returnPeriod)
    ]);
    const warnings = [];

    const t4a3 = zero(), t4a5 = zero(), t4d2 = zero(), rcmLiability = zero();
    const byClass = Object.fromEntries(Object.keys(ITC_CLASSES).map(c => [c, zero()]));
    const suppliers = new Map();

    rows.forEach(r => {
        if (r.itc_available === 'N') { addTo(t4d2, r); return; }
        if (r.reverse_charge === 'Y') { addTo(t4a3, r); addTo(rcmLiability, r); } else addTo(t4a5, r);
        addTo(byClass[r.itc_class] || byClass.COMMON, r);
        const s = suppliers.get(r.supplier_gstin) || { gstin: r.supplier_gstin, name: r.supplier_name, lines: [], total: zero() };
        s.lines.push(r); addTo(s.total, r);
        suppliers.set(r.supplier_gstin, s);
    });
    rcm.forEach(e => {
        addTo(t4a3, e); addTo(rcmLiability, e);
        addTo(byClass[e.itc_class] || byClass.COMMON, e);
    });

    // Rule 42(1): D1 = common credit x exempt turnover / total turnover.
    const exempt = num(turnover.exempt), total = num(turnover.taxable) + exempt;
    const ratio = total > 0 ? exempt / total : 0;
    if (total <= 0) warnings.push('No sales in this month, so the Rule 42 share cannot be worked out. The rule then uses the last month that had sales.');
    const d1 = zero();
    HEADS.concat('txval').forEach(h => { d1[h] = byClass.COMMON[h] * ratio; });

    const reversal = zero(), net = zero(), available = zero();
    HEADS.concat('txval').forEach(h => {
        available[h] = t4a3[h] + t4a5[h];
        reversal[h] = byClass.EXEMPT[h] + byClass.BLOCKED[h] + d1[h];
        net[h] = available[h] - reversal[h];
    });

    // 2B against the lube purchase book.
    const matchedKeys = new Set();
    const in2bNotBook = [];
    rows.filter(r => r.section !== 'CDNR' && r.section !== 'CDNRA').forEach(r => {
        const b = findInBook(book, r);
        if (b) { matchedKeys.add(b.key); r.bookMatch = b; } else in2bNotBook.push(r);
    });
    const inBookNot2b = book.filter(b => b.inPeriod && !matchedKeys.has(b.key));
    const autoCommon = rows.filter(r => r.class_source === 'AUTO' && r.itc_class === 'COMMON').length;
    if (autoCommon) warnings.push(`${autoCommon} line(s) were put under "Common" because the bill is not in the lube purchase book and the supplier has no saved class. Check them.`);

    return {
        uploaded: rows.length > 0,
        uploadInfo,
        rows,
        rcm,
        suppliers: Array.from(suppliers.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        classes: ITC_CLASSES,
        byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, round(v)])),
        rule42: { exempt, taxable: num(turnover.taxable), total, ratio, common: round(byClass.COMMON), d1: round(d1) },
        t4a3: round(t4a3), t4a5: round(t4a5), t4d2: round(t4d2),
        available: round(available), reversal: round(reversal), net: round(net),
        rcmLiability: round(rcmLiability),
        recon: { matched: rows.filter(r => r.bookMatch).length, in2bNotBook, inBookNot2b },
        warnings
    };
}

module.exports = { ITC_CLASSES, parse2b, upload2b, setClass, buildItc };
