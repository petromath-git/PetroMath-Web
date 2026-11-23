// services/smartfleet-statement-parser.js — reads the BPCL SmartFleet "Account Statement" PDF.
//
// Page 1: report date, statement period ("01 Sep 2026 - 30 Sep 2026"), Organization Name,
// Account Number (FA…), and two summary tables whose columns carry letters:
//   Usage Summary, row CMS:  A opening, B recharge, C Ufill generated, D total sale (printed
//                            negative), E TCS, F transfer, G others, H closing
//   Petromiles:              L opening, M accruals, N reversal, O transferred, P redeemed,
//                            Q others, R closing (R = L+M+N+O+P+Q, signs printed)
// Page 2 on: Card Level Sale Summary, then Transaction History, newest first, one row per
// transaction: Sl.No, Date & Time (date line, time line below), Transaction Type (SALE /
// RECHARGE), Transaction Details (card name | card no At <bunk>, or "PCVO" for a BPCL
// recharge), Product | Volume, Wallet (CMS), Purchase Amount, TCS Amount, Total Amount,
// Petromiles Earned. Cells wrap over several text lines, so a row is every text item between
// the midpoints to its neighbouring Sl.No anchors.
//
// The statement shows no running balance, so the rows are put in time order and the balance
// worked out from the opening. Checks (file refused on failure): recharges add up to B, sales
// to D, and opening + rows ends at H.
//
// BPCL recharges the card out of the freight payment: the AP210 payment advice shows each as a
// "FLEET CARD DEBIT" line without the paise, dated the day before or the same day.

const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (s) => {
    const v = parseFloat(String(s == null ? '' : s).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    return isNaN(v) ? 0 : v;
};
const NUM_RE = /^-?[\d,]+(\.\d+)?$/;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad2 = (n) => String(n).padStart(2, '0');

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

const txt = (i) => i.s.replace(/\s+/g, ' ').trim();

function looksLikeSmartfleet(allItems) {
    return allItems.some(i => /^SMARTFLEET$/i.test(txt(i))) && allItems.some(i => /^Account Statement$/i.test(txt(i)));
}

// Value printed to the right of a label on the same line (±3 pt), skipping the ":" items
function valueRightOf(items, labelRe) {
    const lab = items.find(i => labelRe.test(txt(i)));
    if (!lab) return null;
    const v = items.filter(i => i.x > lab.x + 20 && i.x < lab.x + 260 && Math.abs(i.y - lab.y) <= 3 && txt(i) !== ':')
        .sort((a, b) => a.x - b.x)[0];
    return v ? txt(v) : null;
}

// A summary table: the row of single capital letters, then the numbers of one row placed on
// the nearest letter
function lettered(items, letters, rowFilter) {
    const heads = items.filter(i => letters.includes(txt(i)) && txt(i).length === 1);
    const first = heads.find(h => txt(h) === letters[0]);
    if (!first) return null;
    const cols = letters.map(l => heads.filter(h => txt(h) === l).sort((a, b) => Math.abs(a.y - first.y) - Math.abs(b.y - first.y))[0]);
    if (cols.some(c => !c)) return null;
    const vals = items.filter(i => i.y < first.y && NUM_RE.test(txt(i)) && rowFilter(i));
    const out = {};
    for (const v of vals) {
        let best = null;
        cols.forEach((c, k) => { if (best === null || Math.abs(c.x - v.x) < Math.abs(cols[best].x - v.x)) best = k; });
        if (Math.abs(cols[best].x - v.x) <= 30 && out[letters[best]] === undefined) out[letters[best]] = num(v.s);
    }
    return out;
}

function parseHeader(items) {
    const all = items.map(txt).join('\n');
    const out = {};
    let m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*-\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(all);
    if (m && MONTHS[m[2].toLowerCase()] && MONTHS[m[5].toLowerCase()]) {
        out.period_from = `${m[3]}-${pad2(MONTHS[m[2].toLowerCase()])}-${pad2(m[1])}`;
        out.period_to = `${m[6]}-${pad2(MONTHS[m[5].toLowerCase()])}-${pad2(m[4])}`;
    }
    const acct = valueRightOf(items, /^Account Number$/i);
    out.customer_id = acct && /^[A-Z]{2}\d{6,}$/.test(acct) ? acct : null;
    out.customer_name = valueRightOf(items, /^Organization Name$/i);
    out.pan = valueRightOf(items, /^PAN Card Number$/i);

    // Usage Summary, CMS row (the TOTAL row below it repeats the same numbers)
    const cms = items.find(i => txt(i) === 'CMS' && i.x < 150);
    if (cms) {
        const u = lettered(items, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], (i) => Math.abs(i.y - cms.y) <= 3 && i.x > cms.x + 30);
        if (u && u.A !== undefined && u.H !== undefined) {
            out.ccms = { opening: u.A, recharge: u.B || 0, ufill: u.C || 0, sale: Math.abs(u.D || 0), sale_complete: 0,
                tcs: u.E || 0, transfer: u.F || 0, others: u.G || 0, closing: u.H };
        }
    }
    // Petromiles: the one numeric row under the L..R letters
    const pmHead = items.find(i => txt(i) === 'L');
    if (pmHead) {
        const rowY = items.filter(i => i.y < pmHead.y - 15 && i.y > pmHead.y - 80 && NUM_RE.test(txt(i)) && i.x > 80)
            .map(i => i.y).sort((a, b) => b - a)[0];
        if (rowY !== undefined) {
            const p = lettered(items, ['L', 'M', 'N', 'O', 'P', 'Q', 'R'], (i) => Math.abs(i.y - rowY) <= 3);
            if (p && p.L !== undefined && p.R !== undefined) {
                out.loyalty = { opening: p.L, award: p.M || 0, reversal: p.N || 0, transferred: p.O || 0,
                    redemption: Math.abs(p.P || 0), others: p.Q || 0, withheld: 0, tds: 0, expiry: 0, closing: p.R };
            }
        }
    }
    return out;
}

// Columns from the transaction header labels on a page
function layoutOf(items) {
    const dt = items.find(i => /^Date & Time$/i.test(txt(i)));
    if (!dt) return null;
    const near = (re) => items.find(i => re.test(txt(i)) && Math.abs(i.y - dt.y) <= 14);
    const xs = {
        type: near(/^Transaction$/i), details: near(/^Transaction Details$/i), product: near(/^Product \/$/i),
        wallet: near(/^Wallet$/i), purchase: near(/^Purchase$/i), tcs: near(/^TCS$/i), total: near(/^Total$/i), miles: near(/^Petromiles$/i),
    };
    if (Object.values(xs).some(v => !v)) return null;
    const headerY = Math.min(...items.filter(i => Math.abs(i.y - dt.y) <= 14).map(i => i.y));
    // a column starts a little left of its label (values are right-aligned under amount labels)
    const cols = [
        { key: 'sno', from: -Infinity },
        { key: 'date', from: dt.x - 15 },
        { key: 'type', from: xs.type.x - 8 },
        { key: 'details', from: xs.details.x - 8 },
        { key: 'product', from: xs.product.x - 10 },
        { key: 'wallet', from: xs.wallet.x - 8 },
        { key: 'purchase', from: xs.purchase.x - 8 },
        { key: 'tcs', from: xs.tcs.x - 8 },
        { key: 'total', from: xs.total.x - 12 },
        { key: 'miles', from: xs.miles.x - 2 },
    ];
    return { headerY, cols, dateX: dt.x };
}

function columnOf(cols, x) {
    let key = cols[0].key;
    for (const c of cols) if (x >= c.from) key = c.key;
    return key;
}

function parseRows(items, layout) {
    const { headerY, cols, dateX } = layout;
    const footer = items.find(i => /^You may refer to|^Statement is based on|End of Statement/i.test(txt(i)) && i.y < headerY);
    const floorY = footer ? footer.y : 30;
    const anchors = items.filter(i => i.y < headerY - 2 && i.y > floorY && i.x < dateX - 15 && /^\d+$/.test(txt(i)))
        .sort((a, b) => b.y - a.y);
    return anchors.map((a, k) => {
        const top = k === 0 ? headerY - 2 : (anchors[k - 1].y + a.y) / 2;
        const bottom = k === anchors.length - 1 ? Math.max(a.y - 28, floorY + 1) : (a.y + anchors[k + 1].y) / 2;
        const cells = {};
        items.filter(i => i.y < top && i.y > bottom)
            .sort((p, q) => (q.y - p.y) || (p.x - q.x))
            .forEach(i => {
                const key = columnOf(cols, i.x);
                (cells[key] = cells[key] || []).push(txt(i));
            });
        return cells;
    });
}

function toTime(dateCell) {
    const s = (dateCell || []).join(' ');
    const d = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    if (!d) return { date: null, time: null };
    const t = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(s);
    let time = null;
    if (t) {
        let h = Number(t[1]);
        const ap = t[3].toUpperCase();
        if (ap === 'PM' && h < 12) h += 12;
        if (ap === 'AM' && h === 12) h = 0;
        time = `${pad2(h)}:${t[2]}:00`;
    }
    const date = `${d[3]}-${d[2]}-${d[1]}`;
    return { date, time: time ? `${date} ${time}` : null };
}

function kindOf(type) {
    const t = String(type || '').toUpperCase();
    if (/RECHARGE/.test(t)) return 'RECHARGE';
    if (/REVERS|REFUND|VOID|CANCEL/.test(t)) return 'REVERSAL';
    if (/SALE/.test(t)) return 'SALE';
    return 'OTHER';
}

async function parseSmartfleetStatement(buffer) {
    if (!buffer || buffer.length < 5 || buffer.slice(0, 5).toString('latin1') !== '%PDF-') throw new Error('This is not a PDF file.');
    const pages = await loadItems(buffer);
    const all = [].concat(...pages);
    if (!looksLikeSmartfleet(all)) throw new Error('This PDF is not a SmartFleet Account Statement.');

    const summary = parseHeader(pages[0] || []);
    summary.program = 'SMARTFLEET';
    if (!summary.customer_id || !summary.period_from) throw new Error('Account Number or statement period not found.');
    if (!summary.ccms) throw new Error('The Usage Summary CMS line (opening / recharge / sale / closing) was not found.');

    const rows = [];
    for (const items of pages) {
        const layout = layoutOf(items);
        if (!layout) continue;
        for (const c of parseRows(items, layout)) {
            const j = (k) => (c[k] || []).join(' ').replace(/\s+/g, ' ').trim();
            const { date, time } = toTime(c.date);
            const details = j('details');
            const prod = j('product');
            const pm = /^(.*?)\s*\|\s*([\d.,]+)?\s*$/.exec(prod);
            const card = /\|\s*([A-Z]{2}\d{6,})/.exec(details);
            const at = /\bAt\s+(.+)$/i.exec(details);
            // "<name on card> | <card no> At <bunk>": the name is a vehicle no only if it looks like one
            const cardName = card ? details.split('|')[0].trim().replace(/\s/g, '').toUpperCase() : '';
            const row = {
                stmt_sno: Number(j('sno')),
                txn_type: j('type') || null,
                txn_date: date,
                txn_time: time,
                vehicle_no: /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(cardName) ? cardName : null,
                card_name: cardName || null,
                card_no: card ? card[1] : null,
                merchant: at ? at[1].trim() : (details || null),
                product: pm ? pm[1].trim() || null : (prod || null),
                volume: pm && pm[2] ? num(pm[2]) : null,
                currency: j('wallet') || null,
                purchase: r2(num(j('purchase'))),
                tcs: r2(num(j('tcs'))),
                amount: r2(num(j('total'))),
                points: num(j('miles')),
            };
            if (!row.amount && row.purchase) row.amount = r2(row.purchase + row.tcs);
            row.kind = kindOf(row.txn_type);
            rows.push(row);
        }
    }
    if (!rows.length && (summary.ccms.recharge || summary.ccms.sale)) throw new Error('No transactions found, but the summary shows activity.');
    if (rows.some(r => !r.txn_date)) throw new Error('A transaction without a date was found. The file was not read correctly.');

    // Oldest first, then balance from the opening
    rows.sort((a, b) => String(a.txn_time || a.txn_date).localeCompare(String(b.txn_time || b.txn_date)) || (b.stmt_sno - a.stmt_sno));
    let bal = summary.ccms.opening;
    const txns = rows.map((r, k) => {
        const sign = r.kind === 'RECHARGE' || r.kind === 'REVERSAL' ? 1 : r.kind === 'SALE' ? -1 : 0;
        if (sign === 0) throw new Error(`Row ${r.stmt_sno} (${r.txn_type}, ${r.amount}): unknown card transaction type.`);
        bal = r2(bal + sign * r.amount);
        return { ...r, sno: k + 1, balance: bal, txn_ref: r.kind === 'RECHARGE' ? (r.merchant || null) : null, merchant: r.kind === 'RECHARGE' ? 'BPCL' : r.merchant };
    });
    const sum = (k, f = 'amount') => r2(txns.filter(t => t.kind === k).reduce((s, t) => s + t[f], 0));
    if (Math.abs(sum('RECHARGE') - summary.ccms.recharge) > 0.01) {
        throw new Error(`Recharges add up to ${sum('RECHARGE')}, the summary shows ${summary.ccms.recharge}.`);
    }
    if (Math.abs(sum('SALE') - sum('REVERSAL') - summary.ccms.sale) > 0.01) {
        throw new Error(`Sales add up to ${r2(sum('SALE') - sum('REVERSAL'))}, the summary shows ${summary.ccms.sale}.`);
    }
    if (Math.abs(bal - summary.ccms.closing) > 0.01) {
        throw new Error(`The card transactions end at ${bal.toFixed(2)}, the summary closing balance is ${summary.ccms.closing.toFixed(2)}.`);
    }
    const warnings = [];
    const c = summary.ccms;
    const close = r2(c.opening + c.recharge - c.ufill - c.sale - c.tcs + c.transfer + c.others);
    if (Math.abs(close - c.closing) > 0.01) warnings.push(`Usage summary does not add up: ${close.toFixed(2)} vs closing ${c.closing.toFixed(2)}.`);
    if (c.ufill || c.transfer || c.others) warnings.push('The statement shows Ufill / transfer / other amounts; PetroMath does not book those.');
    if (summary.loyalty) {
        const L = summary.loyalty;
        const earned = r2(txns.reduce((s, t) => s + (t.points || 0), 0));
        if (Math.abs(earned - L.award) > 1) warnings.push(`Petromiles on the rows add up to ${earned}, the summary accruals are ${L.award}.`);
        const pclose = r2(L.opening + L.award + L.reversal + L.transferred - L.redemption + L.others);
        if (Math.abs(pclose - L.closing) > 1) warnings.push(`Petromiles summary does not add up: ${pclose} vs closing ${L.closing}.`);
    }
    return { summary, txns, warnings };
}

module.exports = { parseSmartfleetStatement, looksLikeSmartfleet };
