// "GST Workings" Excel for a month: everything needed to file GSTR-1 and GSTR-3B by hand on
// the portal, without the JSON. Same figures as /gst/gstr1 and /gst/gstr3b (built from the
// GST Summary queries); the GSTR-1 sheet is in the portal's table order with the rounded
// values the portal shows, and the Summary sheet follows the auditor's monthly working.
const ExcelJS = require('exceljs');
const moment = require('moment');

const MONEY = '#,##,##0.00';
const num = (n) => parseFloat(n || 0);
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

function sheetHelpers(ws) {
    let row = 1;
    const api = {
        title(text) {
            ws.getCell(row, 1).value = text;
            ws.getCell(row, 1).font = { bold: true, size: 13 };
            row += 1;
        },
        section(text, note) {
            row += 1;
            ws.getCell(row, 1).value = text;
            ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF1F4E79' } };
            if (note) { ws.getCell(row + 1, 1).value = note; ws.getCell(row + 1, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } }; row += 1; }
            row += 1;
        },
        header(cols) {
            cols.forEach((c, i) => {
                const cell = ws.getCell(row, i + 1);
                cell.value = c;
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF7' } };
                cell.border = { bottom: { style: 'thin' } };
            });
            row += 1;
        },
        // values: numbers get the money format unless listed in plain (column indexes)
        line(values, opts = {}) {
            values.forEach((v, i) => {
                const cell = ws.getCell(row, i + 1);
                cell.value = v;
                if (typeof v === 'number' && !(opts.plain || []).includes(i)) cell.numFmt = MONEY;
                if (opts.bold) cell.font = { bold: true };
                if (opts.type && typeof v === 'number') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3C4' } };
            });
            row += 1;
        },
        none(text) { ws.getCell(row, 1).value = text || 'Nil'; ws.getCell(row, 1).font = { italic: true }; row += 1; }
    };
    return api;
}

function addGstr1Sheet(wb, w) {
    const r = w.gstr1, j = r.json;
    const ws = wb.addWorksheet('GSTR-1');
    ws.columns = [{ width: 34 }, { width: 18 }, { width: 14 }, { width: 16 }, { width: 10 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
    const s = sheetHelpers(ws);
    s.title(`GSTR-1 · ${w.period.label} · GSTIN ${w.gstin}`);
    s.line(['Type these on the portal: Returns Dashboard › GSTR-1 › Prepare Online. Values are as the portal rounds them.']);

    s.section('4A · B2B invoices (registered customers)');
    s.header(['Customer GSTIN', 'Invoice no', 'Invoice date', 'Invoice value', 'POS', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST']);
    if (j.b2b && j.b2b.length) {
        j.b2b.forEach(c => c.inv.forEach(inv => inv.itms.forEach((it, k) => {
            const d = it.itm_det;
            s.line([c.ctin, inv.inum, inv.idt, k === 0 ? inv.val : null, inv.pos, d.rt, d.txval, d.iamt, d.camt, d.samt], { plain: [5] });
        })));
    } else s.none();

    s.section('7 · B2C (others) — one line per rate', 'Supply type Intra-State, place of supply ' + w.gstin.substring(0, 2));
    s.header(['Place of supply', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST']);
    if (j.b2cs && j.b2cs.length) j.b2cs.forEach(b => s.line([b.pos, b.rt, b.txval, b.iamt, b.camt, b.samt], { plain: [1] }));
    else s.none();

    s.section('8 · Nil rated, exempted and non-GST supplies (petrol, diesel)');
    s.header(['Description', 'Nil rated', 'Exempted', 'Non-GST']);
    const nilRows = (j.nil && j.nil.inv) || [];
    const label = { INTRAB2B: 'Intra-State supplies to registered persons', INTRAB2C: 'Intra-State supplies to unregistered persons' };
    if (nilRows.length) nilRows.forEach(n => s.line([label[n.sply_ty] || n.sply_ty, n.nil_amt, n.expt_amt, n.ngsup_amt]));
    else s.none();

    const hsnRows = (rows, title) => {
        s.section(title);
        s.header(['HSN', 'Description', 'UQC', 'Total quantity', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST']);
        if (rows && rows.length) rows.forEach(h => s.line([h.hsn_sc, h.desc, h.uqc, h.qty, h.rt, h.txval, h.iamt, h.camt, h.samt], { plain: [3, 4] }));
        else s.none();
    };
    hsnRows(j.hsn && j.hsn.hsn_b2b, '12 · HSN summary — B2B tab');
    hsnRows(j.hsn && j.hsn.hsn_b2c, '12 · HSN summary — B2C tab');

    s.section('13 · Documents issued');
    s.header(['Nature of document', 'Sr. no. from', 'Sr. no. to', 'Total number', 'Cancelled', 'Net issued']);
    const nature = { 1: 'Invoices for outward supply', 2: 'Invoices for inward supply from unregistered person' };
    if (r.docs.length) r.docs.forEach(d => s.line([nature[d.doc_num], d.from, d.to, d.totnum, d.cancel, d.net_issue], { plain: [3, 4, 5] }));
    else s.none();
}

function addGstr3bSheet(wb, w) {
    const i = w.itc, p = w.payment;
    const ws = wb.addWorksheet('GSTR-3B');
    ws.columns = [{ width: 62 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }];
    const s = sheetHelpers(ws);
    s.title(`GSTR-3B · ${w.period.label} · GSTIN ${w.gstin} · due ${w.period.due}`);
    s.line(['Yellow cells are typed on the portal; the rest are filled by the portal from GSTR-1 / 2B — check they match.']);

    s.section('3.1 Outward supplies and inward supplies liable to reverse charge');
    s.header(['Nature of supplies', 'Total taxable value', 'IGST', 'CGST', 'SGST']);
    s.line(['(a) Outward taxable supplies', w.t31a.txval, w.t31a.igst, w.t31a.cgst, w.t31a.sgst]);
    s.line(['(b) Outward taxable supplies (zero rated)', 0, 0, null, null]);
    s.line(['(c) Other outward supplies (nil rated, exempted)', w.t31c]);
    s.line(['(d) Inward supplies (liable to reverse charge)', w.t31d.txval, w.t31d.igst, w.t31d.cgst, w.t31d.sgst], { type: true });
    s.line(['(e) Non-GST outward supplies', w.t31e]);
    s.line(['3.1.1 and 3.2: all zero (no e-commerce sales, no inter-state sales)']);

    s.section('4 Eligible ITC');
    s.header(['Details', '', 'IGST', 'CGST', 'SGST']);
    s.line(['A(1) Import of goods / A(2) Import of services / A(4) ISD', null, 0, 0, 0]);
    s.line(['A(3) Inward supplies liable to reverse charge', null, i.t4a3.igst, i.t4a3.cgst, i.t4a3.sgst], { type: true });
    s.line(['A(5) All other ITC', null, i.t4a5.igst, i.t4a5.cgst, i.t4a5.sgst]);
    s.line(['B(1) As per rules 38, 42 & 43 and section 17(5)', null, i.reversal.igst, i.reversal.cgst, i.reversal.sgst], { type: true });
    s.line(['B(2) Others', null, 0, 0, 0]);
    s.line(['C. Net ITC available (A − B)', null, i.net.igst, i.net.cgst, i.net.sgst], { bold: true });
    s.line(['D(2) Ineligible ITC (section 16(4), place of supply)', null, i.t4d2.igst, i.t4d2.cgst, i.t4d2.sgst]);
    s.line([`Rule 42: ${(i.rule42.ratio * 100).toFixed(4)}% of turnover is petrol / diesel / nil, so that share of common credit (CGST ${r2(i.rule42.common.cgst)}) is reversed: ${r2(i.rule42.d1.cgst)}`]);

    s.section('5 Exempt, nil-rated and non-GST inward supplies');
    s.header(['Nature of supplies', 'Inter-State', 'Intra-State']);
    s.line(['From a supplier under composition scheme, exempt, nil rated', 0, 0]);
    s.line(['Non-GST supply (petrol, diesel bought — before VAT)', 0, w.t5.nonGst], { type: true });
    s.line([`Same invoices with VAT: ${w.t5.nonGstWithVat} (the figure filed up to Apr-2026)`]);

    s.section('5.1 Interest and late fee');
    s.header(['', '', 'IGST', 'CGST', 'SGST']);
    s.line(['Interest', null, 0, w.interest.cgst, w.interest.sgst]);
    s.line(['Late fee', null, 0, w.lateFee.cgst, w.lateFee.sgst]);

    s.section('6.1 Payment of tax', 'Liability rounded to the rupee as the portal shows it. Credit ledger brought forward: ' +
        `IGST ${w.inputs.ecl_open_igst}, CGST ${w.inputs.ecl_open_cgst}, SGST ${w.inputs.ecl_open_sgst}`);
    s.header(['Description', 'Tax payable', 'Paid by IGST credit', 'Paid by CGST credit', 'Paid by SGST credit']);
    ['igst', 'cgst', 'sgst'].forEach(h => s.line([`(A) ${h.toUpperCase()}`, w.liability[h], p.paid[h].igst, p.paid[h].cgst, p.paid[h].sgst], { type: true }));
    s.header(['', 'Tax paid in cash', 'Interest', 'Late fee', '']);
    ['igst', 'cgst', 'sgst'].forEach(h => s.line([`(A) ${h.toUpperCase()} cash`, p.cash[h], w.interest[h], w.lateFee[h]], { type: true }));
    ['igst', 'cgst', 'sgst'].forEach(h => s.line([`(B) Reverse charge ${h.toUpperCase()} — cash only`, w.rcmCash[h]], { type: true }));
    s.line(['Total cash to pay (challan)', w.cashTotal], { bold: true });
    s.line(['Credit ledger left for next month', null, p.closing.igst, p.closing.cgst, p.closing.sgst]);
}

// The auditor's one-page monthly working: sales and tax on the left, credit on the right.
function addSummarySheet(wb, w, locationName) {
    const r = w.gstr1, i = w.itc;
    const ws = wb.addWorksheet('Summary');
    ws.columns = [{ width: 36 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 3 }, { width: 36 }, { width: 18 }, { width: 14 }, { width: 14 }];
    const s = sheetHelpers(ws);
    s.title(`${locationName} — Taxable Sales, Non-GST Sales and Purchase — ${w.period.label}`);
    s.line([`GSTIN ${w.gstin}`]);
    s.section('Outward supplies');
    s.header(['Particulars', 'Amount', 'CGST', 'SGST']);
    const hsnAll = [].concat((r.json.hsn && r.json.hsn.hsn_b2b) || [], (r.json.hsn && r.json.hsn.hsn_b2c) || []).filter(h => h.rt > 0);
    const byRate = new Map();
    hsnAll.forEach(h => {
        const key = `${h.desc.substring(0, 28)} @ ${h.rt}%`;
        const t = byRate.get(key) || { txval: 0, camt: 0, samt: 0 };
        t.txval += h.txval; t.camt += h.camt; t.samt += h.samt; byRate.set(key, t);
    });
    byRate.forEach((t, k) => s.line([k, r2(t.txval), r2(t.camt), r2(t.samt)]));
    r.fuel.forEach(f => s.line([`Non-GST ${f.product}`, r2(f.total)]));
    w.itc.rcm.forEach(e => s.line([`RCM — ${e.description}`, num(e.taxable_value), num(e.cgst), num(e.sgst)]));
    s.line(['Total (sales + RCM)', r2(w.t31a.txval + w.t31e + w.t31d.txval), r2(w.t31a.cgst + w.t31d.cgst), r2(w.t31a.sgst + w.t31d.sgst)], { bold: true });
    s.line(['GSTR-1 (taxable + non-GST)', r2(w.t31a.txval + w.t31e + w.t31c), w.t31a.cgst, w.t31a.sgst]);

    s.section('Input tax credit');
    s.header(['Particulars', 'Amount', 'CGST', 'SGST']);
    s.line(['ITC on RCM', i.t4a3.txval, i.t4a3.cgst, i.t4a3.sgst]);
    Object.entries(i.classes).forEach(([k, label]) => {
        const c = i.byClass[k];
        if (c.cgst || c.sgst) s.line([label, c.txval, c.cgst, c.sgst]);
    });
    s.line(['Less: reversed (Rule 42 + 17(5))', null, -i.reversal.cgst, -i.reversal.sgst]);
    s.line(['Net ITC', null, i.net.cgst, i.net.sgst], { bold: true });
    s.line(['Non-GST inward supplies (fuel bought, before VAT)', w.t5.nonGst]);

    s.section('Tax payable');
    s.header(['', 'IGST', 'CGST', 'SGST']);
    s.line(['E-Credit ledger brought forward', w.inputs.ecl_open_igst, w.inputs.ecl_open_cgst, w.inputs.ecl_open_sgst]);
    s.line(['Gross GST payable (sales + RCM)', 0, r2(w.t31a.cgst + w.t31d.cgst), r2(w.t31a.sgst + w.t31d.sgst)]);
    s.line(['Less: ITC used', w.payment.paid.igst.igst + w.payment.paid.cgst.igst + w.payment.paid.sgst.igst,
        w.payment.paid.cgst.cgst + w.payment.paid.igst.cgst, w.payment.paid.sgst.sgst + w.payment.paid.igst.sgst]);
    s.line(['Cash to pay (incl. RCM, interest, late fee)', w.cashTotal], { bold: true });
    s.line(['ITC carried to next month', w.payment.closing.igst, w.payment.closing.cgst, w.payment.closing.sgst]);

    s.section('Documents issued');
    s.header(['Series', 'From', 'To', 'Total']);
    r.docs.forEach(d => s.line([d.series, d.from, d.to, d.totnum], { plain: [3] }));
}

function addDetailSheet(wb, w, fmtDate) {
    const i = w.itc;
    const ws = wb.addWorksheet('ITC and fuel detail');
    ws.columns = [{ width: 36 }, { width: 18 }, { width: 18 }, { width: 13 }, { width: 15 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 30 }];
    const s = sheetHelpers(ws);
    s.title(`GSTR-2B lines, reverse charge and fuel purchases · ${w.period.label}`);
    s.section('GSTR-2B lines');
    s.header(['Supplier', 'GSTIN', 'Bill', 'Date', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Use (credit)']);
    if (i.rows.length) i.rows.forEach(x => s.line([x.supplier_name, x.supplier_gstin, x.doc_no, fmtDate(x.doc_date), num(x.taxable_value), num(x.igst), num(x.cgst), num(x.sgst), i.classes[x.itc_class] || x.itc_class]));
    else s.none('GSTR-2B not uploaded for this month');
    s.section('Reverse charge self-invoices');
    s.header(['From', 'What', 'Self-invoice', 'Date', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Use (credit)']);
    if (i.rcm.length) i.rcm.forEach(e => s.line([e.supplier_name, e.description, e.self_invoice_no, fmtDate(e.self_invoice_date), num(e.taxable_value), num(e.igst), num(e.cgst), num(e.sgst), i.classes[e.itc_class] || e.itc_class]));
    else s.none();
    s.section('Fuel bought (oil company invoices)');
    s.header(['Invoice', 'Date', 'Before VAT', 'VAT etc.', 'Invoice total']);
    if (w.t5.invoices.length) w.t5.invoices.forEach(f => s.line([f.invoice_number, fmtDate(f.invoice_date), num(f.line_amount), num(f.charges), num(f.total_invoice_amount)]));
    else s.none();
}

async function buildWorkbook(w, locationName) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PetroMath';
    wb.created = new Date();
    const fmtDate = (d) => d ? moment(d).format('DD-MMM-YYYY') : '';
    addSummarySheet(wb, w, locationName);
    addGstr1Sheet(wb, w);
    addGstr3bSheet(wb, w);
    addDetailSheet(wb, w, fmtDate);
    return wb;
}

module.exports = { buildWorkbook };
