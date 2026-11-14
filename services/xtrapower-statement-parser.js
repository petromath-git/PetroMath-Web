// services/xtrapower-statement-parser.js — reads the IOCL XTRAPOWER fleet card "Monthly Statement" PDF.
//
// Page 1: period, customer id / name, and two summary lines:
//   CCMS     OP. BAL, RECHARGE, CCMS SALE, CCMS Sale Complete, CL BALANCE        (rupees)
//   LOYALTY  OP. BAL, AWARD, REDEMPTION, WITH HELD, TDS, EXPIRY, CL BALANCE, ...  (XTRAPoints)
// Then one row per transaction: SNo, Terminal ID, MID, Merchant Name, PAN, State, Location,
// Customer ID/Card, Vehicle No., Txn ID, Txn Date, Settlement Date, Txn Type, Product, Currency,
// Amount, Balance, Status. Cells wrap onto 2-3 text lines a few points above and below the row,
// so a row is every text item between the midpoints to its neighbours, and a cell is the items
// in that column's x range. Columns are placed from the header row on each page.
//
// Checks (file refused on failure): CCMS rows chain balance to balance, and both the CCMS and
// the loyalty totals tie to the summary lines.

const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (s) => {
    const v = parseFloat(String(s == null ? '' : s).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    return isNaN(v) ? 0 : v;
};
// Dates come in two shapes, depending on how the statement was downloaded:
//   DD/MM/YYYY HH:MM:SS          e.g. 04/07/2026 12:03:23
//   M/D/YYYY h:mm:ss AM/PM       e.g. 7/4/2026 12:03:23 PM   (tkt #469, MME Jul-2026)
// The order is decided once per file from the period end, whose day is always 28 or more.
const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i;
const pad2 = (n) => String(n).padStart(2, '0');
function dateOrder(periodTo) {
    const m = /(\d{1,2})\/(\d{1,2})\/\d{4}/.exec(String(periodTo || ''));
    return m && Number(m[2]) > 12 ? 'MDY' : 'DMY';
}
function dateReader(order) {
    const parts = (s) => {
        const m = DATE_RE.exec(String(s || ''));
        if (!m) return null;
        const [d, mo] = order === 'MDY' ? [m[2], m[1]] : [m[1], m[2]];
        if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
        let time = null;
        if (m[4] !== undefined) {
            let h = Number(m[4]);
            const ap = (m[7] || '').toUpperCase();
            if (ap === 'PM' && h < 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            time = `${pad2(h)}:${m[5]}:${m[6] || '00'}`;
        }
        return { date: `${m[3]}-${pad2(mo)}-${pad2(d)}`, time };
    };
    return {
        iso: (s) => { const p = parts(s); return p ? p.date : null; },
        isoTime: (s) => { const p = parts(s); return p ? p.date + (p.time ? ' ' + p.time : '') : null; }
    };
}

// Header labels -> column key. x of each label is read per page.
const HEADERS = [
    ['SNo.', 'sno'], ['Terminal ID', 'terminal_id'], ['MID', 'mid'], ['Merchant Name', 'merchant'], ['Pan', 'pan'],
    ['State', 'state'], ['Location', 'location'], ['Customer ID/Card', 'card'], ['Vehicle No.', 'vehicle'],
    ['Txn ID', 'txn_id'], ['Txn Date', 'txn_date'], ['Settlement Date', 'settle_date'], ['Txn Type', 'txn_type'],
    ['Product', 'product'], ['Currency', 'currency'], ['Amount', 'amount'], ['Balance', 'balance'], ['Status', 'status']
];

async function loadItems(buffer) {
    const doc = await PDFJS.getDocument({ data: new Uint8Array(buffer) });
    const pages = [];
    try {
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const content = await page.getTextContent();
            pages.push(content.items.map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str })).filter(i => i.s.trim() !== ''));
        }
    } finally {
        doc.destroy();
    }
    return pages;
}

// Items on one y (±1.5), left to right
function lineAt(items, y) {
    return items.filter(i => Math.abs(i.y - y) <= 1.5).sort((a, b) => a.x - b.x);
}

function parseSummary(items) {
    const out = { ccms: null, loyalty: null, period_from: null, period_to: null, customer_id: null, customer_name: null };
    const text = (i) => i.s.replace(/\s+/g, ' ').trim();
    for (const it of items) {
        let m;
        if ((m = /Period:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*To\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(it.s))) {
            out.date_order = dateOrder(m[2]);
            const { iso } = dateReader(out.date_order);
            out.period_from = iso(m[1]); out.period_to = iso(m[2]);
        }
        if ((m = /Customer ID:\s*(\d+)/i.exec(it.s)) && !out.customer_id) out.customer_id = m[1];
        if ((m = /Customer Name:\s*(.+)$/i.exec(it.s))) out.customer_name = m[1].trim();
    }
    // Summary values sit on the line next to the "CCMS" / "LOYALTY" labels (left column)
    const label = (re) => items.find(i => i.x < 60 && re.test(text(i)));
    const values = (lab) => {
        if (!lab) return null;
        const cands = items.filter(i => i.x > lab.x + 40 && Math.abs(i.y - lab.y) <= 3 && /^-?[\d,]+(\.\d+)?$/.test(text(i)))
            .sort((a, b) => a.x - b.x);
        return cands.map(i => num(i.s));
    };
    const c = values(label(/^CCMS$/));
    if (c && c.length >= 5) out.ccms = { opening: c[0], recharge: c[1], sale: c[2], sale_complete: c[3], closing: c[4] };
    const l = values(label(/^LOYALTY$/));
    if (l && l.length >= 7) {
        out.loyalty = { opening: l[0], award: l[1], redemption: l[2], withheld: l[3], tds: l[4], expiry: l[5], closing: l[6],
            eligible_rs: l[7] || 0, daily_award: l[8] || 0, other_award: l[9] || 0 };
    }
    return out;
}

function columnsFrom(items) {
    // Header row: the "SNo." label and everything near its y (labels wrap, e.g. Customer ID/Card / PAN)
    const sno = items.find(i => i.s.trim() === 'SNo.');
    if (!sno) return null;
    const head = items.filter(i => Math.abs(i.y - sno.y) <= 8);
    const cols = [];
    for (const [label, key] of HEADERS) {
        const h = head.find(i => i.s.trim().toLowerCase() === label.toLowerCase());
        if (h) cols.push({ key, x: h.x });
    }
    if (cols.length < HEADERS.length - 2) return null;
    cols.sort((a, b) => a.x - b.x);
    // Values sit up to ~18 pt left of their label (labels have leading spaces, MID is centred),
    // so a column starts halfway from the previous label. Balance is right-aligned and runs up to
    // the Status label, so Status starts just left of its own label.
    cols.forEach((c, k) => {
        c.from = k === 0 ? -Infinity : c.key === 'status' ? c.x - 4 : (cols[k - 1].x + c.x) / 2;
    });
    return { headerY: Math.min(...head.map(i => i.y)), cols };
}

function columnOf(cols, x) {
    let key = cols[0].key;
    for (const c of cols) if (x >= c.from) key = c.key;
    return key;
}

function parseRows(items, layout) {
    const { cols, headerY } = layout;
    const snoCol = cols.find(c => c.key === 'sno');
    const terminalCol = cols.find(c => c.key === 'terminal_id');
    const anchors = items
        .filter(i => i.y < headerY - 2 && i.x < (terminalCol ? terminalCol.x - 2 : snoCol.x + 20) && /^\d+$/.test(i.s.trim()))
        .sort((a, b) => b.y - a.y);
    const rows = [];
    anchors.forEach((a, k) => {
        const top = k === 0 ? headerY - 2 : (anchors[k - 1].y + a.y) / 2;
        const bottom = k === anchors.length - 1 ? a.y - 13 : (a.y + anchors[k + 1].y) / 2;
        const band = items.filter(i => i.y < top && i.y > bottom);
        const cells = {};
        band.sort((p, q) => (q.y - p.y) || (p.x - q.x)).forEach(i => {
            const key = columnOf(cols, i.x);
            cells[key] = cells[key] === undefined ? i.s : `${cells[key]}${/\s$/.test(cells[key]) || /^\s/.test(i.s) ? '' : (key === 'state' || key === 'currency' || key === 'vehicle' ? '' : ' ')}${i.s}`;
        });
        Object.keys(cells).forEach(k2 => { cells[k2] = cells[k2].replace(/\s+/g, ' ').trim(); });
        rows.push(cells);
    });
    return rows;
}

// Txn kinds used by PetroMath
function kindOf(row) {
    const t = (row.txn_type || '').toUpperCase().replace(/\s+/g, ' ');
    const cur = (row.currency || '').toUpperCase();
    const merchant = (row.merchant || '').toUpperCase();
    if (cur.startsWith('XTRAPOINT')) {
        if (/TDS/.test(merchant)) return 'LOYALTY_TDS';
        if (/AWARD/.test(t)) return 'LOYALTY_AWARD';
        if (/REDEEM|REDEMPTION/.test(t)) return 'LOYALTY_REDEEM';
        if (/EXPIR/.test(t)) return 'LOYALTY_EXPIRY';
        return 'LOYALTY_OTHER';
    }
    // Points converted to card money: a CCMS recharge from IOCL HO - LOYALTY (no running balance shown)
    if (/RECHARGE/.test(t) && /LOYALTY/.test(merchant)) return 'POINTS_TO_CARD';
    if (/RECHARGE/.test(t)) return 'RECHARGE';
    if (/SALE COMPLETE/.test(t)) return 'SALE_COMPLETE';
    if (/SALE/.test(t)) return 'SALE';
    if (/REVERS|REFUND|VOID/.test(t)) return 'REVERSAL';
    return 'OTHER';
}

async function parseXtrapowerStatement(buffer) {
    if (!buffer || buffer.length < 5 || buffer.slice(0, 5).toString('latin1') !== '%PDF-') throw new Error('This is not a PDF file.');
    const pages = await loadItems(buffer);
    const all = [].concat(...pages);
    if (!all.some(i => /XTRAPOWER Monthly Statement/i.test(i.s))) {
        throw new Error('This PDF is not an XTRAPOWER Monthly Statement.');
    }
    const summary = parseSummary(pages[0] || []);
    if (!summary.customer_id || !summary.period_from) throw new Error('Customer ID or statement period not found.');
    if (!summary.ccms) throw new Error('The CCMS summary line (opening / recharge / sale / closing) was not found.');
    const { iso, isoTime } = dateReader(summary.date_order);

    const txns = [];
    for (const items of pages) {
        const layout = columnsFrom(items);
        if (!layout) continue;
        for (const c of parseRows(items, layout)) {
            const row = {
                sno: Number(c.sno),
                terminal_id: c.terminal_id || null,
                merchant: c.merchant || null,
                merchant_pan: c.pan || null,
                location: [c.location, c.state].filter(Boolean).join(', ') || null,
                card_no: c.card || null,
                vehicle_no: c.vehicle && c.vehicle !== '-' ? c.vehicle.replace(/\s/g, '') : null,
                txn_ref: c.txn_id || null,
                txn_time: isoTime(c.txn_date),
                txn_date: iso(c.txn_date),
                settle_date: iso(c.settle_date),
                txn_type: c.txn_type || null,
                product: c.product ? c.product.replace(/^'/, '').replace(/,$/, '') : null,
                currency: c.currency || null,
                amount: r2(num(c.amount)),
                balance: r2(num(c.balance)),
                status: c.status || null
            };
            row.kind = kindOf(row);
            txns.push(row);
        }
    }
    if (!txns.length && (summary.ccms.recharge || summary.ccms.sale)) throw new Error('No transactions found, but the summary shows activity.');

    // CCMS chain: opening -> each rupee row -> closing
    const ccms = txns.filter(t => !t.kind.startsWith('LOYALTY'));
    let bal = summary.ccms.opening;
    for (const t of ccms) {
        const sign = ['RECHARGE', 'REVERSAL', 'POINTS_TO_CARD'].includes(t.kind) ? 1 : t.kind === 'SALE' || t.kind === 'SALE_COMPLETE' ? -1 : 0;
        if (sign === 0) throw new Error(`Row ${t.sno} (${t.txn_type}, ${t.amount}): unknown card transaction type.`);
        bal = r2(bal + sign * t.amount);
        if (t.kind === 'POINTS_TO_CARD' && t.balance === 0) { t.balance = bal; continue; }
        if (Math.abs(bal - t.balance) > 0.01) {
            throw new Error(`Row ${t.sno} (${t.txn_type} ${t.amount} on ${t.txn_date}): balance should be ${bal.toFixed(2)}, the statement shows ${t.balance.toFixed(2)}. The file was not read correctly.`);
        }
    }
    if (Math.abs(bal - summary.ccms.closing) > 0.01) {
        throw new Error(`The card transactions end at ${bal.toFixed(2)}, the summary closing balance is ${summary.ccms.closing.toFixed(2)}.`);
    }
    const sum = (k) => r2(txns.filter(t => t.kind === k).reduce((s, t) => s + t.amount, 0));
    if (Math.abs(sum('RECHARGE') + sum('POINTS_TO_CARD') - summary.ccms.recharge) > 0.01) {
        throw new Error(`Recharges add up to ${r2(sum('RECHARGE') + sum('POINTS_TO_CARD'))}, the summary shows ${summary.ccms.recharge}.`);
    }
    if (Math.abs(sum('SALE') + sum('SALE_COMPLETE') - summary.ccms.sale - summary.ccms.sale_complete) > 0.01) {
        throw new Error(`Sales add up to ${r2(sum('SALE') + sum('SALE_COMPLETE'))}, the summary shows ${r2(summary.ccms.sale + summary.ccms.sale_complete)}.`);
    }
    const warnings = [];
    if (summary.loyalty) {
        const L = summary.loyalty;
        // Some downloads (MME Jul-2026, tkt #469) also count the loyalty TDS under REDEMPTION:
        // redemption = TDS, with no redeem rows. Count it once, as TDS, like the other months.
        if (L.redemption && Math.abs(L.redemption - L.tds) <= 1 && sum('LOYALTY_REDEEM') === 0 && Math.abs(sum('LOYALTY_TDS') - L.tds) <= 1) {
            L.redemption = 0;
        }
        const checks = [['awards', sum('LOYALTY_AWARD'), L.award], ['TDS', sum('LOYALTY_TDS'), L.tds],
            ['redemptions', sum('LOYALTY_REDEEM'), L.redemption], ['expiry', sum('LOYALTY_EXPIRY'), L.expiry]];
        for (const [what, got, want] of checks) {
            if (Math.abs(got - want) > 1) warnings.push(`Loyalty ${what}: rows add up to ${got} points, the summary shows ${want}.`);
        }
        const close = r2(L.opening + L.award - L.redemption - L.withheld - L.tds - L.expiry);
        if (Math.abs(close - L.closing) > 1) warnings.push(`Loyalty summary does not add up: ${close} vs closing ${L.closing}.`);
    }
    if (txns.some(t => t.kind === 'LOYALTY_OTHER' || t.kind === 'OTHER')) {
        warnings.push(`Some rows have a type PetroMath does not know (${Array.from(new Set(txns.filter(t => /OTHER/.test(t.kind)).map(t => t.txn_type))).join(', ')}); they are kept but not booked.`);
    }
    return { summary, txns, warnings };
}

module.exports = { parseXtrapowerStatement };
