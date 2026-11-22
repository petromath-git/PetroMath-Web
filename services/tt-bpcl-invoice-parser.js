// services/tt-bpcl-invoice-parser.js — reads BPCL's monthly tank-truck self-invoice statement (Transport module).
//
// BPCL SAP prints one PDF per month per vendor + plant ("Statement for the period 08/2026 for
// Vendor Code 215266 and Plant 1352"). It is issued in the dealer's name (Supplier Details = the
// dealer) to the BPCL installation (Bill To Party), GTA service, GST under reverse charge.
//   header      Supplier Details (name, GSTIN), Bill To Party Details (name, GSTIN), SAC
//   per invoice "Invoice No. 2152662027000015  DOC ZZ  FI / LIV Doc no 8700555120  Invoice Date 19.08.2026"
//               then one row per shipment line:
//               Desp.Date, Shipment, Vehicle No., Ship-To-Party, Material, Quantity, UOM, Rate,
//               Distance, Amount, CGST, SGST, IGST
//               and "Total <FI doc no> amount cgst sgst igst"
//   DOC ZZ      freight: amount = KL x rate x distance / 100 (rate is per KL per 100 km)
//   DOC YB      toll charges recovered from BPCL: one row per shipment, quantity / rate / distance 0,
//               amount = toll; GST is charged on it too (still reverse charge)
// One PDF holds several invoices, and an invoice can run over a page break.
//
// Cells are placed in columns by their x position against the "Desp.Date ..." header row, so a
// blank Material (toll rows) does not shift the other columns. Every invoice must add up to its
// printed Total, or the file is refused.

const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const TOLERANCE = 0.05;
const COLUMNS = [
    ['desp_date', /^Desp\.?Date$/i], ['shipment', /^Shipment$/i], ['vehicle', /^Vehicle No\.?$/i],
    ['ship_to', /^Ship-To-Party$/i], ['material', /^Material$/i], ['qty', /^Quantity$/i], ['uom', /^UOM$/i],
    ['rate', /^Rate$/i], ['distance', /^Distance$/i], ['amount', /^Amount$/i], ['cgst', /^CGST Amt$/i],
    ['sgst', /^SGST Amt$/i], ['igst', /^IGST Amt$/i],
];
// What each SAP document type on the statement is
const DOC_TYPES = { ZZ: 'FREIGHT', YB: 'TOLL' };

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function toNumber(s) {
    const v = parseFloat(String(s == null ? '' : s).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    return isNaN(v) ? 0 : v;
}

function isoDate(s) {
    const m = DATE_RE.exec(String(s || '').trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Every text item of the file as rows: items sharing a y on a page, left to right, top to bottom.
async function loadRows(buffer) {
    const doc = await PDFJS.getDocument({ data: new Uint8Array(buffer) });
    const rows = [];
    try {
        for (let p = 1; p <= doc.numPages; p++) {
            const content = await (await doc.getPage(p)).getTextContent();
            const byY = new Map();
            for (const item of content.items) {
                if (!String(item.str).trim()) continue;
                const y = Math.round(item.transform[5]);
                if (!byY.has(y)) byY.set(y, []);
                byY.get(y).push({ x: item.transform[4], s: String(item.str) });
            }
            Array.from(byY.entries()).sort((a, b) => b[0] - a[0]).forEach(([y, cells]) => {
                cells.sort((a, b) => a.x - b.x);
                rows.push({ page: p, y, cells, text: cells.map(c => c.s).join(' ').replace(/\s+/g, ' ').trim() });
            });
        }
    } finally {
        doc.destroy();
    }
    return rows;
}

// Header row -> [{ key, x }] sorted by x; null when the row is not the column header
function columnsFrom(row) {
    const cols = [];
    for (const c of row.cells) {
        const hit = COLUMNS.find(([, re]) => re.test(c.s.trim()));
        if (hit) cols.push({ key: hit[0], x: c.x });
    }
    return cols.length >= 10 ? cols : null;
}

// A row's cells by column: each cell goes to the last column starting at or before it (a few
// points of slack, numbers sit slightly right of their label)
function cellsByColumn(row, cols) {
    const out = {};
    for (const c of row.cells) {
        let col = null;
        for (const k of cols) { if (c.x >= k.x - 4) col = k; }
        if (!col) continue;
        out[col.key] = out[col.key] ? `${out[col.key]} ${c.s.trim()}` : c.s.trim();
    }
    return out;
}

function sumLines(lines) {
    const t = { gross: 0, penalty: 0, igst: 0, cgst: 0, sgst: 0 };
    lines.forEach(l => { t.gross += l.gross_amount; t.igst += l.igst_amount; t.cgst += l.cgst_amount; t.sgst += l.sgst_amount; });
    Object.keys(t).forEach(k => { t[k] = r2(t[k]); });
    return t;
}

const sameTotals = (a, b) => ['gross', 'igst', 'cgst', 'sgst'].every(k => Math.abs(a[k] - b[k]) <= TOLERANCE);
const fmt = (t) => `amount ${t.gross.toFixed(2)}, CGST ${t.cgst.toFixed(2)}, SGST ${t.sgst.toFixed(2)}, IGST ${t.igst.toFixed(2)}`;

// True when the text looks like a BPCL TT statement (used to pick the parser)
function looksLikeBpclStatement(text) {
    return /FI\s*\/\s*LIV Doc no/i.test(text) && /Statement for the period/i.test(text);
}

// Returns { oil_company: 'BPCL', header, bills[], warnings[] } in the shape tt-service expects
// (bills[].totals = { gross, penalty, igst, cgst, sgst }). Throws with a readable message when the
// file is not a BPCL statement or does not add up.
async function parseBpclTransportStatement(buffer) {
    if (!buffer || buffer.length < 5 || buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
        throw new Error('This is not a PDF file.');
    }
    const rows = await loadRows(buffer);
    const fullText = rows.map(r => r.text).join('\n');
    if (!looksLikeBpclStatement(fullText)) {
        throw new Error('This PDF is not a BPCL tank truck statement (no "FI / LIV Doc no" / "Statement for the period" found).');
    }

    const header = { vendor_name: null, vendor_code: null, vendor_gstin: null, period_from: null, period_to: null,
        generated_on: null, recipient_name: null, recipient_gstin: null, recipient_address: null, plant: null, sac_code: null };
    let m;
    if ((m = /Statement for the period\s*(\d{2})\/(\d{4})\s*for Vendor Code\s*(\d+)\s*and Plant\s*(\w+)/i.exec(fullText))) {
        const [, mm, yyyy, code, plant] = m;
        header.vendor_code = code.replace(/^0+/, '');
        header.plant = plant;
        header.period_from = `${yyyy}-${mm}-01`;
        header.period_to = new Date(Date.UTC(Number(yyyy), Number(mm), 0)).toISOString().slice(0, 10);
    }
    if ((m = /HSN\/SAC CODE:\s*(\d{4,8})/i.exec(fullText))) header.sac_code = m[1];

    // Header blocks on page 1, above the first invoice: Supplier at the left, Bill To at the right
    const page1 = rows.filter(r => r.page === 1);
    const supplierX = (() => { for (const r of page1) { const c = r.cells.find(x => /^Supplier Details/i.test(x.s.trim())); if (c) return c.x; } return null; })();
    const billToX = (() => { for (const r of page1) { const c = r.cells.find(x => /^Bill To Party Details/i.test(x.s.trim())); if (c) return c.x; } return null; })();
    const firstInvoiceY = (() => { const r = page1.find(x => /^Invoice No/i.test(x.text)); return r ? r.y : -1; })();
    const supplierLines = [], billToLines = [];
    for (const r of page1) {
        if (r.y <= firstInvoiceY) break;
        if (/Supplier Details|Bill To Party Details|Service Description/i.test(r.text)) continue;
        const left = r.cells.filter(c => supplierX !== null && Math.abs(c.x - supplierX) < 150).map(c => c.s).join('').trim();
        const right = r.cells.filter(c => billToX !== null && c.x >= billToX - 4).map(c => c.s).join('').replace(/\s+/g, ' ').trim();
        if (left) supplierLines.push(left);
        if (right) billToLines.push(right);
    }
    const gstinIn = (lines) => { for (const l of lines) { const g = /GSTIN No\.?\s*:\s*([0-9A-Z]{15})/i.exec(l); if (g) return g[1].toUpperCase(); } return null; };
    header.vendor_gstin = gstinIn(supplierLines);
    header.vendor_name = supplierLines.length ? supplierLines[0].replace(/,\s*$/, '') : null;
    header.recipient_gstin = gstinIn(billToLines);
    const billToAddr = billToLines.filter(l => !/GSTIN|Place Of Supply/i.test(l));
    // Name lines run until the line with the PIN code
    const pinAt = billToAddr.findIndex(l => /\b\d{6}\b/.test(l));
    const nameLines = pinAt > 0 ? billToAddr.slice(0, pinAt) : billToAddr.slice(0, 1);
    header.recipient_name = nameLines.join(' ').replace(/\s*,\s*/g, ', ').replace(/,\s*$/, '').replace(/\s+/g, ' ').trim() || null;
    header.recipient_address = pinAt >= 0 ? billToAddr[pinAt].replace(/\s*,\s*/g, ', ').trim() : null;
    if (!header.vendor_gstin) throw new Error('Supplier GSTIN ("GSTIN No. :" under Supplier Details) not found on the statement.');

    const bills = [];
    const warnings = [];
    let bill = null, cols = null;
    for (const row of rows) {
        const t = row.text;
        if ((m = /^Invoice No\s*\.?\s*(\d{6,20})\s+DOC\s+(\w+)\s+FI\s*\/\s*LIV Doc no\s+(\d+)\s+Invoice Date\s+(\d{2}\.\d{2}\.\d{4})/i.exec(t))) {
            const docType = m[2].toUpperCase();
            bill = { bill_no: m[1], doc_type: docType, bill_type: DOC_TYPES[docType] || null, fi_doc_no: m[3],
                bill_date: isoDate(m[4]), reverse_charge: 'Y', lines: [], totals: null };
            bills.push(bill);
            continue;
        }
        const hdr = columnsFrom(row);
        if (hdr) { cols = hdr; continue; }
        if (/^Total\b/i.test(t)) {
            if (!bill) throw new Error('A "Total" line was found before any invoice.');
            const n = row.cells.slice(1).map(c => toNumber(c.s));
            // Total <FI doc no> amount cgst sgst igst
            if (n.length < 5) throw new Error(`Invoice ${bill.bill_no}: the Total line could not be read.`);
            const [docNo, gross, cgst, sgst, igst] = n.slice(-5);
            if (String(docNo) !== String(Number(bill.fi_doc_no))) {
                throw new Error(`Invoice ${bill.bill_no}: the Total line is for document ${docNo}, not ${bill.fi_doc_no}. The file was not read correctly.`);
            }
            bill.totals = { gross: r2(gross), penalty: 0, cgst: r2(cgst), sgst: r2(sgst), igst: r2(igst) };
            bill = null; // rows after a Total belong to no invoice until the next "Invoice No."
            continue;
        }
        if (!cols || !row.cells.length || !DATE_RE.test(row.cells[0].s.trim())) continue;
        if (!bill) throw new Error(`A shipment row (${t.substring(0, 40)}…) was found outside an invoice.`);
        const c = cellsByColumn(row, cols);
        const qty = toNumber(c.qty), rate = toNumber(c.rate), distance = toNumber(c.distance);
        const line = {
            sno: bill.lines.length + 1,
            vehicle_no: c.vehicle ? c.vehicle.replace(/\s/g, '').toUpperCase() : null,
            delivery_invoice_no: c.shipment || null,
            item_no: null,
            delivery_date: isoDate(c.desp_date),
            ship_to_code: null,
            ship_to_name: c.ship_to || null,
            material_code: c.material || null,
            qty_kl: qty,
            shortage: 0,
            // Kept in the IOCL shape: km in rtd_p, rate per KL-km in rate_p (BPCL prints it per 100 km)
            rtd_p: distance, rtd_h: 0, rtd_hh: 0,
            rate_p: Math.round(rate / 100 * 1e6) / 1e6, rate_h: 0, rate_hh: 0,
            gross_amount: r2(toNumber(c.amount)),
            penalty_amount: 0,
            igst_amount: r2(toNumber(c.igst)),
            cgst_amount: r2(toNumber(c.cgst)),
            sgst_amount: r2(toNumber(c.sgst)),
            printed_rate: rate,
        };
        line.expected_gross = qty > 0 ? r2(qty * rate * distance / 100) : line.gross_amount;
        bill.lines.push(line);
    }

    if (!bills.length) throw new Error('No invoices found in the file.');
    for (const b of bills) {
        if (!b.lines.length) throw new Error(`Invoice ${b.bill_no} has no shipment rows.`);
        if (!b.totals) throw new Error(`Invoice ${b.bill_no}: its "Total" line was not found.`);
        const sum = sumLines(b.lines);
        if (!sameTotals(sum, b.totals)) {
            throw new Error(`Invoice ${b.bill_no}: the rows add up to ${fmt(sum)} but the invoice prints ${fmt(b.totals)}. The file was not read correctly.`);
        }
        if (!b.bill_type) {
            // An unknown document type: decide by the rows, and say so
            b.bill_type = b.lines.every(l => l.qty_kl === 0) ? 'TOLL' : 'FREIGHT';
            warnings.push(`Invoice ${b.bill_no} is document type ${b.doc_type}, which has not been seen before. It is taken as ${b.bill_type === 'TOLL' ? 'toll' : 'freight'} because ${b.bill_type === 'TOLL' ? 'it has no quantities' : 'it has quantities'}.`);
        }
        if (b.bill_type === 'FREIGHT') {
            b.lines.forEach(l => {
                if (Math.abs(l.expected_gross - l.gross_amount) > 0.05) {
                    warnings.push(`Invoice ${b.bill_no} shipment ${l.delivery_invoice_no}: ${l.qty_kl} KL x ${l.printed_rate} x ${l.rtd_p} km / 100 = ${l.expected_gross.toFixed(2)}, the invoice shows ${l.gross_amount.toFixed(2)}.`);
                }
            });
        }
        const dates = b.lines.map(l => l.delivery_date).filter(Boolean).sort();
        b.period_from = dates[0] || header.period_from;
        b.period_to = dates[dates.length - 1] || header.period_to;
        b.lines.forEach(l => { delete l.expected_gross; delete l.printed_rate; });
    }

    return { oil_company: 'BPCL', header, bills, allBills: null, warnings };
}

module.exports = { parseBpclTransportStatement, looksLikeBpclStatement };
