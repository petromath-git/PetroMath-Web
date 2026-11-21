// services/oil-charge-invoice-parser.js — reads IOCL's charge invoice PDFs (tkt #484).
//
// Two layouts, both text PDFs from IOCL's SAP:
//
//   LFR  "TAX INVOICE" — License Fee Recovery, monthly on the 26th. Header: Invoice No (GST,
//        e.g. TN5542025732), SAP Invoice (e.g. 7005878697, also in the SAP statement narration),
//        Date, IOCL GST-, dealer GSTIN, Payer Code. A rate table per product (MS / HSD, Rs/KL),
//        then one row per fuel invoice line the fee is charged on:
//          Sr, Delivery, Date, Invoice, Inv.Date, Net.Price, SGST, CGST, IGST, UGST, KCess, Amount
//        and "Total" on the last page.
//
//   GST INVOICE — one service per invoice: E-Lock recovery, XtraPower participation fee,
//        merchant consent incentive, VMUS rental... Label/value pairs (Invoice No., Date of
//        Invoice, FI Document No., GSTIN x2), "Other Details:", a service row (S.No, service
//        head, HSN/SAC, Qty, Unit, Rate, Amount), Central / State / Integrated taxes and TOTAL.
//
// Text is read from pdf.js items grouped by y position, so the columns stay apart. Only
// numbers are taken from the tax rows (the labels sit on the wrong rows in plain-text dumps).
// Every invoice must add up to its printed total, or the file is refused.

const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const GSTIN_RE = /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]/;
const TOLERANCE = 0.05;

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const isNum = (s) => /^-?[\d,]+(\.\d+)?$/.test(String(s || '').trim());

function toNumber(s) {
    const v = parseFloat(String(s == null ? '' : s).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    return isNaN(v) ? 0 : v;
}

// dd.mm.yyyy -> yyyy-mm-dd
function isoDate(s) {
    const m = DATE_RE.exec(String(s || '').trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Rows of { y, cells: [{ x, s }], text } per page, top to bottom, cells left to right.
async function loadPages(buffer) {
    const doc = await PDFJS.getDocument({ data: new Uint8Array(buffer) });
    const pages = [];
    try {
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const content = await page.getTextContent();
            const byY = new Map();
            for (const item of content.items) {
                const s = String(item.str || '').trim();
                if (!s) continue;
                const y = Math.round(item.transform[5]);
                if (!byY.has(y)) byY.set(y, []);
                byY.get(y).push({ x: item.transform[4], s });
            }
            const rows = Array.from(byY.entries())
                .sort((a, b) => b[0] - a[0])
                .map(([y, cells]) => {
                    cells.sort((a, b) => a.x - b.x);
                    return { y, cells, text: cells.map(c => c.s).join(' ').replace(/\s+/g, ' ') };
                });
            pages.push(rows);
        }
    } finally {
        doc.destroy();
    }
    return pages;
}

const fmt = (n) => Number(n).toFixed(2);

// ── LFR "TAX INVOICE" ────────────────────────────────────────────────────────
function parseLfr(pages) {
    const all = [].concat(...pages);
    const head = { template: 'LFR', invoice_no: null, sap_ref: null, invoice_date: null, supplier_gstin: null,
        recipient_gstin: null, recipient_name: null, payer_code: null, description: 'License Fee Recovery' };
    const products = [];
    const lines = new Map(); // sno -> line (page headers repeat; rows don't)
    let printedTotal = null;

    for (const row of pages[0] || []) {
        for (const c of row.cells) {
            let m;
            if (!head.invoice_no && (m = /^Invoice No\s*:\s*(\S+)$/i.exec(c.s))) head.invoice_no = m[1];
            if (!head.sap_ref && (m = /^SAP Invoice\s*:\s*(\d+)$/i.exec(c.s))) head.sap_ref = m[1];
            if (!head.invoice_date && (m = /^Date\s*:\s*(\d{2}\.\d{2}\.\d{4})$/i.exec(c.s))) head.invoice_date = isoDate(m[1]);
            if (!head.supplier_gstin && (m = /^GST-\s*(\S+)$/i.exec(c.s))) head.supplier_gstin = m[1].toUpperCase();
            if (!head.recipient_gstin && (m = /^GSTIN\s*:\s*(\S+)$/i.exec(c.s))) head.recipient_gstin = m[1].toUpperCase();
            if (!head.recipient_name && (m = /^Name\s*:\s*(.+)$/i.exec(c.s))) head.recipient_name = m[1].trim();
            if (!head.payer_code && (m = /^Payer Code\s*:\s*(\d+)$/i.exec(c.s))) head.payer_code = m[1];
        }
    }

    for (let ri = 0; ri < all.length; ri++) {
        const row = all[ri];
        const c = row.cells.map(x => x.s);
        // product rate row: MS | 997212 | 48.000 | 443.50 | 18.00%
        if (c.length >= 5 && /^[A-Z][A-Z0-9 ]{0,15}$/.test(c[0]) && /^\d{6,8}$/.test(c[1]) && /%$/.test(c[c.length - 1])) {
            products.push({ product: c[0], sac_code: c[1], qty_kl: toNumber(c[2]), rate_per_kl: toNumber(c[3]),
                gst_rate: toNumber(c[c.length - 1]) });
            continue;
        }
        // breakup row: 12 cells, Sr + delivery + date + invoice + date + 7 numbers
        if (c.length === 12 && /^\d+$/.test(c[0]) && /^\d{6,12}$/.test(c[1]) && DATE_RE.test(c[2])
            && /^\d{6,15}$/.test(c[3]) && DATE_RE.test(c[4]) && c.slice(5).every(isNum)) {
            const n = c.slice(5).map(toNumber);
            const line = {
                sno: Number(c[0]), delivery_no: c[1], delivery_date: isoDate(c[2]),
                purchase_invoice_no: c[3], purchase_invoice_date: isoDate(c[4]),
                net_amount: r2(n[0]), sgst_amount: r2(n[1]), cgst_amount: r2(n[2]),
                igst_amount: r2(n[3] + n[4]), cess: r2(n[5]), line_amount: r2(n[6])
            };
            if (lines.has(line.sno)) throw new Error(`Row ${line.sno} appears twice in the invoice. The file was not read correctly.`);
            lines.set(line.sno, line);
            continue;
        }
        if (c.length === 2 && /^Total$/i.test(c[0]) && isNum(c[1])) {
            // a long total wraps its last digit(s) onto the next line: "106759.0" + "8"
            let s = c[1];
            const next = all[ri + 1];
            if (/\.\d?$/.test(s) && next && next.cells.length === 1 && /^\d{1,2}$/.test(next.cells[0].s)
                && next.cells[0].x > row.cells[1].x && row.y - next.y < 20) {
                s += next.cells[0].s;
            }
            printedTotal = r2(toNumber(s));
        }
    }

    if (!head.invoice_no) throw new Error('Invoice No not found on the LFR invoice.');
    if (!head.invoice_date) throw new Error('Invoice date not found on the LFR invoice.');
    if (printedTotal === null) throw new Error('The "Total" line was not found on the LFR invoice.');
    const list = Array.from(lines.values()).sort((a, b) => a.sno - b.sno);
    if (!list.length) throw new Error('No fuel invoice rows found on the LFR invoice.');

    list.forEach((l, i) => {
        if (l.sno !== i + 1) throw new Error(`Row ${i + 1} is missing from the LFR invoice. The file was not read correctly.`);
        const sum = r2(l.net_amount + l.sgst_amount + l.cgst_amount + l.igst_amount + l.cess);
        if (Math.abs(sum - l.line_amount) > TOLERANCE) {
            throw new Error(`Row ${l.sno}: ${fmt(l.net_amount)} + taxes = ${fmt(sum)}, but the row shows ${fmt(l.line_amount)}. The file was not read correctly.`);
        }
        // product from the rate: the one that gives a whole number of KL (tankers carry whole KL)
        let best = null;
        for (const p of products) {
            if (!(p.rate_per_kl > 0)) continue;
            const kl = l.net_amount / p.rate_per_kl;
            const off = Math.abs(kl - Math.round(kl));
            if (!best || off < best.off) best = { p, kl, off };
        }
        l.product = best ? best.p.product : null;
        l.rate_per_kl = best ? best.p.rate_per_kl : null;
        l.qty_kl = best ? r3(best.kl) : null;
    });

    const t = { taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, cess_amount: 0, total_amount: 0 };
    list.forEach(l => {
        t.taxable_value += l.net_amount; t.cgst_amount += l.cgst_amount; t.sgst_amount += l.sgst_amount;
        t.igst_amount += l.igst_amount; t.cess_amount += l.cess; t.total_amount += l.line_amount;
    });
    Object.keys(t).forEach(k => { t[k] = r2(t[k]); });
    if (Math.abs(t.total_amount - printedTotal) > TOLERANCE) {
        throw new Error(`The ${list.length} rows add up to ${fmt(t.total_amount)} but the invoice total is ${fmt(printedTotal)}. The file was not read correctly.`);
    }
    t.total_amount = printedTotal;

    const warnings = [];
    const sacs = Array.from(new Set(products.map(p => p.sac_code)));
    const productKl = {};
    list.forEach(l => { if (l.product) productKl[l.product] = r3((productKl[l.product] || 0) + l.qty_kl); });
    products.forEach(p => {
        if (Math.abs((productKl[p.product] || 0) - p.qty_kl) > 0.001) {
            warnings.push(`${p.product}: the rows add up to ${(productKl[p.product] || 0).toFixed(3)} KL, the summary shows ${p.qty_kl.toFixed(3)} KL.`);
        }
    });

    return {
        ...head, ...t,
        sac_code: sacs.length === 1 ? sacs[0] : null,
        total_kl: r3(list.reduce((s, l) => s + (l.qty_kl || 0), 0)),
        service_head: 'License Fee Recovery',
        products, lines: list, warnings
    };
}

// ── "GST INVOICE" (E-Lock, participation fee, merchant consent, VMUS ...) ─────
function parseGstInvoice(pages) {
    const rows = pages[0] || [];
    const head = { template: 'GST_INVOICE', invoice_no: null, sap_ref: null, invoice_date: null, supplier_gstin: null,
        recipient_gstin: null, recipient_name: null, description: null };
    const valueAfter = (row, label) => {
        const i = row.cells.findIndex(c => c.s.replace(/\s+/g, ' ').toLowerCase() === label.toLowerCase());
        return i >= 0 && row.cells[i + 1] ? row.cells[i + 1].s : null;
    };
    let headerY = null, totalSupplyY = null;
    let taxable = null, cgst = null, sgst = null, igst = null, cess = 0, printedTotal = null;
    const lastNumber = (row) => {
        const nums = row.cells.filter(c => isNum(c.s));
        return nums.length ? toNumber(nums[nums.length - 1].s) : null;
    };

    for (const row of rows) {
        const t = row.text;
        let v;
        if (!head.invoice_no && (v = valueAfter(row, 'Invoice No.'))) head.invoice_no = v;
        if (!head.invoice_date && (v = valueAfter(row, 'Date of Invoice'))) head.invoice_date = isoDate(v);
        if (!head.sap_ref && (v = valueAfter(row, 'FI Document No.'))) head.sap_ref = v;
        if (!head.recipient_name && (v = valueAfter(row, 'Name'))) head.recipient_name = v;
        // two GSTIN labels: supplier on the left block, recipient on the right
        row.cells.forEach((c, i) => {
            if (c.s === 'GSTIN' && row.cells[i + 1] && GSTIN_RE.test(row.cells[i + 1].s)) {
                if (c.x < 200) head.supplier_gstin = row.cells[i + 1].s.toUpperCase();
                else head.recipient_gstin = row.cells[i + 1].s.toUpperCase();
            }
        });
        if (/^Other Details\s*:/i.test(t)) head.description = t.replace(/^Other Details\s*:\s*/i, '').trim() || null;
        if (/^S\.?No\.?\b/i.test(t) && /Service Head/i.test(t)) headerY = row.y;
        if (/^Total Amount of supply/i.test(t)) { totalSupplyY = row.y; taxable = lastNumber(row); }
        if (/^Central Taxes/i.test(t)) cgst = lastNumber(row);
        if (/^State Taxes/i.test(t)) sgst = lastNumber(row);
        if (/^Integrated Taxes/i.test(t)) igst = lastNumber(row);
        if (/^(Kerala )?Cess\b/i.test(t)) cess += lastNumber(row) || 0;
        const ti = row.cells.findIndex(c => /^TOTAL$/.test(c.s));
        if (ti >= 0 && row.cells[ti + 1] && isNum(row.cells[ti + 1].s)) printedTotal = r2(toNumber(row.cells[ti + 1].s));
    }

    if (!head.invoice_no) throw new Error('"Invoice No." not found on the GST invoice.');
    if (!head.invoice_date) throw new Error('"Date of Invoice" not found on the GST invoice.');
    if (taxable === null) throw new Error('"Total Amount of supply" not found on the GST invoice.');
    if (printedTotal === null) throw new Error('The TOTAL amount was not found on the GST invoice.');

    // Service rows sit between the column header and "Total Amount of supply". A row with the
    // SAC code is a line; its name may wrap onto the rows just above / below it.
    const band = rows.filter(r => headerY !== null && totalSupplyY !== null && r.y < headerY - 8 && r.y > totalSupplyY);
    const lineRows = band.filter(r => r.cells.some(c => /^\d{6}[A-Z]?$/.test(c.s)) && isNum(r.cells[r.cells.length - 1].s));
    const services = lineRows.map(r => {
        const sacIdx = r.cells.findIndex(c => /^\d{6}[A-Z]?$/.test(c.s));
        const sacX = r.cells[sacIdx].x;
        const nameParts = band
            .filter(o => Math.abs(o.y - r.y) <= 12 && (o === r || !lineRows.includes(o)))
            .sort((a, b) => b.y - a.y)
            .map(o => o.cells.filter(c => c.x > 60 && c.x < sacX - 2 && !(o === r && /^\d+$/.test(c.s) && c.x < 80)).map(c => c.s).join(' '))
            .filter(Boolean);
        return {
            service_head: nameParts.join(' ').replace(/\s+/g, ' ').trim(),
            sac_code: r.cells[sacIdx].s.replace(/[^\d]/g, ''),
            amount: r2(toNumber(r.cells[r.cells.length - 1].s))
        };
    });
    if (!services.length) throw new Error('No service line found on the GST invoice.');

    cgst = r2(cgst || 0); sgst = r2(sgst || 0); igst = r2(igst || 0); cess = r2(cess);
    const lineSum = r2(services.reduce((s, x) => s + x.amount, 0));
    if (Math.abs(lineSum - taxable) > TOLERANCE) {
        throw new Error(`The service lines add up to ${fmt(lineSum)} but "Total Amount of supply" is ${fmt(taxable)}. The file was not read correctly.`);
    }
    const sum = r2(taxable + cgst + sgst + igst + cess);
    if (Math.abs(sum - printedTotal) > TOLERANCE) {
        throw new Error(`${fmt(taxable)} + taxes = ${fmt(sum)}, but the invoice TOTAL is ${fmt(printedTotal)}. The file was not read correctly.`);
    }

    return {
        ...head,
        service_head: services.map(s => s.service_head).join('; '),
        sac_code: services[0].sac_code,
        taxable_value: r2(taxable), cgst_amount: cgst, sgst_amount: sgst, igst_amount: igst, cess_amount: cess,
        total_amount: printedTotal, total_kl: null, services, products: [], lines: [], warnings: []
    };
}

// Returns the invoice read from the PDF. Throws with a readable message when the file is not
// an IOCL charge invoice or does not add up.
async function parseOilChargeInvoice(buffer) {
    if (!buffer || buffer.length < 5 || buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
        throw new Error('This is not a PDF file.');
    }
    let pages;
    try {
        pages = await loadPages(buffer);
    } catch (e) {
        throw new Error('The PDF could not be opened.');
    }
    const text = [].concat(...pages).map(r => r.text).join('\n');
    if (!text.trim()) throw new Error('The PDF has no text (a scanned copy?). Download the original invoice from the IOCL email.');
    if (/License Fee\s*Recovery/i.test(text) && /SAP Invoice\s*:/i.test(text)) return { oil_company: 'IOCL', ...parseLfr(pages) };
    if (/GST INVOICE/i.test(text) && /Service Head Name/i.test(text) && /INDIANOIL|INDIAN OIL/i.test(text)) {
        return { oil_company: 'IOCL', ...parseGstInvoice(pages) };
    }
    const e = new Error('This PDF is not an IOCL charge invoice (LFR "TAX INVOICE" or "GST INVOICE").');
    e.code = 'NOT_CHARGE_INVOICE'; // e.g. a fuel invoice or payment receipt in the same mailbox (email import skips these)
    throw e;
}

module.exports = { parseOilChargeInvoice, isoDate, toNumber };
