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
 *
 * Shri Balaji Traders (distilled water, battery acid) has used two layouts:
 * Zoho-style (until mid-2026, CGST/SGST % on each line) and Tally (GST % only
 * in the HSN summary). Their lines have no SKU code, so products are
 * remembered by the item description instead.
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

// Key a line's product link is remembered under (t_invoice_product_map)
const mapKey = l => (l.sku_code ? `SKU:${l.sku_code}` : `NAME:${l.sku_name.toUpperCase().replace(/\s+/g, ' ').trim()}`).slice(0, 100);

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

// ── Shri Balaji Traders ─────────────────────────────────────────────────────

const ddmmyyyy = s => { const m = /(\d{2})-(\d{2})-(\d{4})/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const ddMonyyyy = s => {
    const m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s || '');
    return m && MONTHS[m[2].toUpperCase()] ? `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}` : null;
};

// A goods line with no discount: qty x rate = taxable, plus GST at gst_pct
function plainLine(skuName, hsn, qty, unit, rate, taxable, gstPct) {
    const l = {
        sku_code: null, sku_name: skuName.replace(/\s+/g, ' ').trim(), hsn, mrp: null, qty_ltr: null,
        qty, unit, rate, gross: taxable, discount: 0, taxable, gst_pct: gstPct,
        gst_amount: gstPct != null ? Calc.round2(taxable * gstPct / 100) : null, cess: 0
    };
    l.amount = l.gst_amount != null ? Calc.round2(taxable + l.gst_amount) : null;
    l.ok = qty > 0 && near(qty * rate, taxable, 0.05) && Calc.GST_RATES.indexOf(gstPct) >= 0;
    return l;
}

// GST is rounded on the whole invoice here, so the lines may differ from the total by paise
function finish(format, header, lines) {
    const problems = [];
    if (!header.invoice_number) problems.push('Invoice number not found.');
    if (!header.invoice_date) problems.push('Invoice date not found.');
    if (!lines.length) problems.push('No product lines found.');
    lines.forEach((l, n) => { if (!l.ok) problems.push(`Line ${n + 1} (${l.sku_name}): figures don't add up — check it against the invoice.`); });
    const sum = Calc.round2(lines.reduce((a, l) => a + (l.amount || 0), 0));
    if (header.total != null && !near(sum, header.total, 1)) {
        problems.push(`Lines add up to ₹${sum}, but the invoice total is ₹${header.total}.`);
    }
    return { format, header, lines, problems };
}

function sellerTax(all, text) {
    const gst = /GSTIN(?:\/UIN)?\s*:?\s*([0-9]{2}[A-Z0-9]{13})/.exec(text);
    return {
        supplier_gstin: gst ? gst[1] : null,
        cash_discount: 0,
        tax_type: all.some(r => r.cells.some(c => /^IGST/i.test(c.s))) ? 'IGST' : 'CGST_SGST'
    };
}

// Zoho-style: "# | Items & Description | Qty | Rate | CGST | SGST | Amount",
// with the unit ("NO'S") and "HSN: ..." on the rows under each item
function isBalajiZoho(text) {
    return /Items & Description/.test(text) && /Invoice Number/.test(text) && /BALAJI/i.test(text);
}
function parseBalajiZoho(pages) {
    const all = pages.flat();
    const text = all.map(rowText).join('\n');
    const field = label => {
        const r = all.find(r => r.cells.some(c => c.s === label));
        if (!r) return null;
        const next = r.cells[r.cells.findIndex(c => c.s === label) + 1];
        return next ? next.s.replace(/^:\s*/, '').trim() : null;
    };
    const header = {
        invoice_number: field('Invoice Number'),
        invoice_date: ddmmyyyy(field('Invoice Date')),
        supplier_name: rowText(all[0]).trim(),
        ...sellerTax(all, text),
        total: null,
        printed_total: null
    };

    const lines = [];
    let descEnd = null, cur = null;
    const close = () => {
        if (cur) lines.push(plainLine(cur.name.join(' '), cur.hsn, cur.qty, cur.unit, cur.rate, cur.amount, cur.gst));
        cur = null;
    };
    for (const r of all) {
        if (r.cells.some(c => c.s === 'Items & Description')) {
            const qtyHead = r.cells.find(c => c.s === 'Qty');
            descEnd = qtyHead ? qtyHead.x - 20 : null;
            continue;
        }
        if (descEnd == null) continue;
        const first = r.cells[0];
        const totalCell = r.cells.find(c => c.s === 'Total');
        if (totalCell) {
            close();
            const fig = r.cells.find(c => c.x > totalCell.x && /\d/.test(c.s));
            if (fig) header.total = header.printed_total = num(fig.s.replace(/[^\d.,]/g, ''));
            break;
        }
        if (/^\d{1,3}$/.test(first.s) && first.x < 60) {
            close();
            const figs = r.cells.filter(c => c.x >= descEnd);
            const nums = figs.filter(c => isNum(c.s)).map(c => num(c.s));
            if (nums.length < 3) continue;
            cur = {
                name: r.cells.filter((c, k) => k > 0 && c.x < descEnd).map(c => c.s),
                hsn: null,
                unit: 'NOS',
                qty: nums[0],
                rate: nums[1],
                amount: nums[nums.length - 1],
                gst: Calc.round2(figs.filter(c => /%$/.test(c.s)).reduce((a, c) => a + num(c.s.replace('%', '')), 0))
            };
            continue;
        }
        if (r.cells.some(c => /^(CGST|SGST|IGST)\d/.test(c.s))) { close(); continue; }
        if (!cur) continue;
        const hsn = r.cells.find(c => /^HSN:/.test(c.s));
        if (hsn) cur.hsn = hsn.s.replace(/^HSN:\s*/, '');
        else if (r.cells.length === 1 && first.x >= descEnd) cur.unit = first.s.replace(/'/g, '').toUpperCase();
        else cur.name.push(...r.cells.filter(c => c.x < descEnd).map(c => c.s));
    }
    close();
    return finish('BALAJI', header, lines);
}

// Tally: "Sl | Description of Goods | HSN/SAC | Quantity | Rate | per | Amount";
// GST % per HSN comes from the summary table under the items
function isTallyInvoice(text) {
    return /Description of Goods/.test(text) && /HSN\/SAC/.test(text) && /Invoice No\./.test(text);
}
function parseTally(pages) {
    const all = pages.flat();
    const text = all.map(rowText).join('\n');

    // "Invoice No." / "Dated" headings with the values on the next row, same x
    let invoiceNumber = null, invoiceDate = null;
    const hi = all.findIndex(r => r.cells.some(c => c.s === 'Invoice No.'));
    if (hi >= 0) {
        const nx = all[hi].cells.find(c => c.s === 'Invoice No.').x;
        const dated = all[hi].cells.find(c => c.s === 'Dated');
        for (const r of all.slice(hi + 1, hi + 3)) {
            const n = r.cells.find(c => Math.abs(c.x - nx) < 5);
            const d = dated && r.cells.find(c => Math.abs(c.x - dated.x) < 5);
            if (!invoiceNumber && n) invoiceNumber = n.s;
            if (!invoiceDate && d) invoiceDate = ddMonyyyy(d.s);
        }
    }
    const titleIdx = all.findIndex(r => /Tax Invoice/i.test(rowText(r)));
    const sellerCell = all.slice(titleIdx + 1).map(r => r.cells.find(c => c.x < 100)).find(Boolean);
    const header = {
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        supplier_name: sellerCell ? sellerCell.s : null,
        ...sellerTax(all, text),
        total: null,
        printed_total: null
    };

    // HSN summary: "HSN | Taxable | CGST Rate | Amount | SGST Rate | Amount | Total" (or IGST)
    const hsnRate = {};
    const si = all.findIndex(r => r.cells[0].s === 'HSN/SAC' && r.cells.some(c => c.s === 'Taxable'));
    if (si >= 0) {
        for (const r of all.slice(si + 1)) {
            if (r.cells.some(c => c.s === 'Total') || /in words/i.test(rowText(r))) break;
            if (!/^\d{4,8}$/.test(r.cells[0].s)) continue;
            hsnRate[r.cells[0].s] = Calc.round2(r.cells.filter(c => /%$/.test(c.s)).reduce((a, c) => a + num(c.s.replace('%', '')), 0));
        }
    }
    // Fallback: one rate for the invoice from the tax rows ("Cgst 2.5%  2.50  %  88.30")
    const taxRates = all.filter(r => r.cells.some(c => /^(cgst|sgst|igst)\b/i.test(c.s)) && r.cells.some(c => c.s === '%'))
        .map(r => num(r.cells[r.cells.findIndex(c => c.s === '%') - 1].s));
    const flatRate = taxRates.length === 1 || taxRates.length === 2 ? Calc.round2(taxRates.reduce((a, b) => a + b, 0)) : null;

    const lines = [];
    let descEnd = null;
    for (let i = 0; i < all.length; i++) {
        const r = all[i];
        if (r.cells.some(c => c.s === 'Description of Goods')) {
            const hsnHead = r.cells.find(c => c.s === 'HSN/SAC');
            descEnd = hsnHead ? hsnHead.x - 8 : null;
            continue;
        }
        if (descEnd == null) continue;
        const first = r.cells[0];
        if (r.cells.some(c => c.s === 'Total')) {
            // Payable total on this row or just under it ("₹ 3,709.00")
            for (const t of [r, all[i + 1]]) {
                const fig = t && t.cells.filter(c => c.x > 400 && isNum(c.s)).pop();
                if (fig) { header.total = header.printed_total = num(fig.s); break; }
            }
            break;
        }
        if (!(/^\d{1,3}$/.test(first.s) && first.x < 60)) continue;
        const rest = r.cells.filter(c => c.x >= descEnd);
        const hsn = rest[0] && /^\d{4,8}$/.test(rest[0].s) ? rest[0].s : null;
        const qtyCell = rest.find(c => /^[\d,.]+\s+[A-Za-z']+$/.test(c.s));
        const nums = rest.filter(c => c !== rest[0] && isNum(c.s)).map(c => num(c.s));
        if (!qtyCell || nums.length < 2) continue;
        const [q, u] = qtyCell.s.split(/\s+/);
        lines.push(plainLine(
            r.cells.filter((c, k) => k > 0 && c.x < descEnd).map(c => c.s).join(' '),
            hsn, num(q), u.replace(/'/g, '').toUpperCase(), nums[0], nums[nums.length - 1],
            hsn && hsnRate[hsn] != null ? hsnRate[hsn] : flatRate
        ));
    }
    return finish('BALAJI', header, lines);
}

// Returns { format, header, lines, problems }, or null when the layout isn't recognised
async function readInvoicePdf(buffer) {
    const pages = await readRows(buffer);
    const text = pages.flat().map(rowText).join('\n');
    let parsed = null;
    if (isIoclDistributorInvoice(text)) parsed = parseIoclDistributor(pages);
    else if (isBalajiZoho(text)) parsed = parseBalajiZoho(pages);
    else if (isTallyInvoice(text)) parsed = parseTally(pages);
    if (parsed) parsed.lines.forEach(l => { l.map_key = mapKey(l); });
    return parsed;
}

module.exports = { readInvoicePdf, skuPack };
