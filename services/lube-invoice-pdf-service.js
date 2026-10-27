/*
 * Reads a lube purchase invoice PDF into the purchase screen's fields.
 *
 * IOCL distributors (Aravalli, Shakthi Ganesh, ...) all print their invoices
 * from IOCL's distributor billing system, so one layout covers every IOCL
 * distributor. These are digital PDFs (real text, no OCR). pdf-parse's plain
 * text runs the table cells together ("2900234271019716026013CAR4782.82..."),
 * so the PDF is read as positioned text items and rebuilt into rows of cells.
 *
 * IOCL item row (cells left to right):
 *   # | name (last part; the rest wraps onto the rows above) | SKU # | HSN |
 *   MRP (blank for barrels) | Qty (Ltr or Kg) | Qty | Unit (CAR/BUC/BRL/CAN) |
 *   Rate | Net Total | Disc | Taxable Value | GST % | GST Amt | Cess Amt | Net Amt
 * Every line is checked against its own arithmetic (qty x rate = net total,
 * net total - disc = taxable, GST, net amount) before it is trusted.
 */
const pdfParse = require('pdf-parse');
const Calc = require('../public/javascripts/lube-invoice-calc');

const num = s => {
    const n = parseFloat(String(s == null ? '' : s).replace(/,/g, ''));
    return isFinite(n) ? n : null;
};
const isNum = s => /^-?[\d,]*\.?\d+$/.test(String(s));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// PDF → pages of rows; each row is { y, cells: [{ x, s }] } top-down, left to right
async function readRows(buffer) {
    const pages = [];
    await pdfParse(buffer, {
        pagerender: page => page.getTextContent({ normalizeWhitespace: true }).then(tc => {
            const rows = [];
            for (const it of tc.items) {
                const s = String(it.str || '').trim();
                if (!s) continue;
                const x = it.transform[4], y = it.transform[5];
                let row = rows.find(r => Math.abs(r.y - y) <= 2);
                if (!row) rows.push(row = { y, cells: [] });
                row.cells.push({ x, s });
            }
            rows.sort((a, b) => b.y - a.y).forEach(r => r.cells.sort((a, b) => a.x - b.x));
            pages.push(rows);
            return '';
        })
    });
    return pages;
}

const rowText = r => r.cells.map(c => c.s).join(' ');

function isIoclDistributorInvoice(text) {
    return /SKU Name/.test(text) && /SKU #/.test(text) && /Invoice No:/.test(text) && /Taxable/.test(text);
}

// Pieces per carton from an IOCL SKU name: "SERVO 4T-20X1L-HDPE" → 20 x 1 L,
// "SERVO 2T SUPREME(JFC) -300x40ML -POU" → 300 x 0.04 L, "IOC CLEARBLUE-10 L" → 1 x 10 L.
function skuPack(name) {
    const m = /(\d+)\s*[xX]\s*(\d+\/\d+|\d*\.\d+|\d+)\s*(MLS?|LTRS?|LT|L|KGS?|GMS?|G)(?![A-Z])/i.exec(String(name || ''));
    if (m) {
        const one = Calc.parsePackSize(`${m[2]} ${m[3]}`);
        if (one) return { count: parseInt(m[1], 10), size: one.size, measure: one.measure };
    }
    const single = Calc.parsePackSize(name);
    return single ? { count: 1, size: single.size, measure: single.measure } : null;
}

// Right-hand figures after the Unit cell. Layouts seen: 8 figures (no cess %),
// with a cess % column (9), or a blank discount (7). The first layout whose
// arithmetic holds wins.
const RIGHT_LAYOUTS = [
    ['rate', 'gross', 'discount', 'taxable', 'gst_pct', 'gst_amount', 'cess', 'amount'],
    ['rate', 'gross', 'discount', 'taxable', 'gst_pct', 'gst_amount', 'cess_pct', 'cess', 'amount'],
    ['rate', 'gross', 'taxable', 'gst_pct', 'gst_amount', 'cess', 'amount']
];

function lineChecks(l) {
    return near(l.qty * l.rate, l.gross, 1)
        && near(l.gross - l.discount, l.taxable, 0.05)
        && Calc.GST_RATES.indexOf(l.gst_pct) >= 0
        && near(l.taxable * l.gst_pct / 100, l.gst_amount, 0.1)
        && near(l.taxable + l.gst_amount + l.cess, l.amount, 0.05);
}

// cols: { nameEnd, skuEnd } — x where the SKU # and HSN columns start. Long
// names and long SKU numbers wrap onto the rows above the item row
// (SKU 274850184 prints as "27485018" above and "4" on the row), so those
// parts arrive separately.
function parseItemRow(cells, nameParts, skuParts, cols) {
    const name = cells.filter((c, k) => k > 0 && c.x < cols.nameEnd).map(c => c.s);
    const sku = skuParts.concat(cells.filter(c => c.x >= cols.nameEnd && c.x < cols.skuEnd).map(c => c.s)).join('');
    const rest = cells.filter(c => c.x >= cols.skuEnd);
    if (!/^\d{4,12}$/.test(sku) || !rest.length || !/^\d{4,8}$/.test(rest[0].s)) return null;
    const unitIdx = rest.findIndex((c, k) => k > 0 && /^[A-Z]{2,4}$/.test(c.s));
    if (unitIdx < 0) return null;

    // Between HSN and Unit: [MRP], Qty (Ltr or Kg), Qty — MRP is blank on barrels
    const left = rest.slice(1, unitIdx).map(c => num(c.s));
    const right = rest.slice(unitIdx + 1).filter(c => isNum(c.s)).map(c => num(c.s));
    const base = {
        sku_code: sku,
        sku_name: nameParts.concat(name).join(' ').replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim(),
        hsn: rest[0].s,
        mrp: left.length >= 3 ? left[left.length - 3] : null,
        qty_ltr: left.length >= 2 ? left[left.length - 2] : null,
        qty: left.length >= 1 ? left[left.length - 1] : null,
        unit: rest[unitIdx].s
    };
    let best = null;
    for (const layout of RIGHT_LAYOUTS) {
        if (right.length !== layout.length) continue;
        const l = { ...base, discount: 0, cess: 0 };
        layout.forEach((k, n) => { l[k] = right[n]; });
        delete l.cess_pct;
        l.ok = lineChecks(l);
        if (l.ok) return l;
        if (!best) best = l;
    }
    return best || { ...base, ok: false };
}

function parseIoclDistributor(pages) {
    const all = pages.flat();
    const text = all.map(rowText).join('\n');
    const pick = re => { const m = text.match(re); return m ? m[1] : null; };

    const dm = text.match(/Invoice Date:\s*(\d{2})-(\d{2})-(\d{4})/);
    const firstPage = pages[0] || [];
    const supplierRow = firstPage.find(r => !/TAX INVOICE|ORIGINAL|DUPLICATE|TRIPLICATE/i.test(rowText(r)));
    const header = {
        invoice_number: pick(/Invoice No:\s*(\d{6,})/),
        invoice_date: dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null,
        supplier_name: supplierRow ? rowText(supplierRow).trim() : null,
        // The seller's GSTIN is printed first (its address block); Bill To follows
        supplier_gstin: pick(/GSTIN:\s*([0-9]{2}[A-Z0-9]{13})/),
        // "Total Cash Discount" in the footer is only a summary: each line's Disc
        // column already includes its cash discount (see the annexure), and the
        // amount payable is the plain total. So it must not be deducted again.
        cash_discount: 0,
        tax_type: all.some(r => /^IGST/.test(r.cells[0].s) && r.cells.slice(1).some(c => num(c.s) > 0)) ? 'IGST' : 'CGST_SGST',
        total: null,
        printed_total: null
    };

    const lines = [];
    let inTable = false, nameParts = [], skuParts = [], cols = null, afterTotal = null;
    for (const page of pages) {
        for (const r of page) {
            const first = r.cells[0].s;
            const skuHead = r.cells.find(c => c.s === 'SKU #');
            const hsnHead = r.cells.find(c => c.s === 'HSN');
            if (r.cells.some(c => c.s === 'SKU Name') && skuHead && hsnHead) {
                inTable = true;
                nameParts = []; skuParts = [];
                // SKU numbers are printed from just left of the "SKU #" heading;
                // 8-digit HSN codes start a few points left of "HSN"
                cols = { nameEnd: skuHead.x - 5, skuEnd: hsnHead.x - 10 };
                continue;
            }
            if (!inTable) {
                if (afterTotal) afterTotal.push(r);
                continue;
            }
            if (first === 'Total') {
                inTable = false;
                const figs = r.cells.filter(c => isNum(c.s)).map(c => num(c.s));
                header.total = figs.length ? figs[figs.length - 1] : null;
                afterTotal = [];
                continue;
            }
            if (/^\d{1,3}$/.test(first) && r.cells[0].x < cols.nameEnd / 2) {
                const line = parseItemRow(r.cells, nameParts, skuParts, cols);
                if (line) { lines.push(line); nameParts = []; skuParts = []; continue; }
            }
            // Wrapped name / SKU number parts, waiting for their item row
            const nameCells = r.cells.filter(c => c.x < cols.nameEnd);
            if (nameCells.length) nameParts.push(nameCells.map(c => c.s).join(' '));
            r.cells.filter(c => c.x >= cols.nameEnd && c.x < cols.skuEnd && /^\d+$/.test(c.s)).forEach(c => skuParts.push(c.s));
        }
    }

    // Amount payable: the figure printed below the Total row (the total rounded
    // to the rupee)
    if (header.total != null) {
        for (const r of afterTotal || []) {
            if (/Amount In Words/i.test(rowText(r))) break;
            const hit = r.cells.find(c => isNum(c.s) && near(num(c.s), header.total, 1));
            if (hit) { header.printed_total = num(hit.s); break; }
        }
    }

    const problems = [];
    if (!header.invoice_number) problems.push('Invoice number not found.');
    if (!header.invoice_date) problems.push('Invoice date not found.');
    if (!lines.length) problems.push('No product lines found.');
    lines.forEach((l, n) => { if (!l.ok) problems.push(`Line ${n + 1} (${l.sku_name}): figures don't add up — check it against the invoice.`); });
    const sum = Calc.round2(lines.reduce((a, l) => a + (l.amount || 0), 0));
    if (header.total != null && !near(sum, header.total, 0.05)) {
        problems.push(`Lines add up to ₹${sum}, but the invoice total is ₹${header.total}.`);
    }
    return { format: 'IOCL', header, lines, problems };
}

// Returns { format, header, lines, problems }, or null when the layout isn't recognised
async function readInvoicePdf(buffer) {
    const pages = await readRows(buffer);
    const text = pages.flat().map(rowText).join('\n');
    if (isIoclDistributorInvoice(text)) return parseIoclDistributor(pages);
    return null;
}

module.exports = { readInvoicePdf, skuPack };
