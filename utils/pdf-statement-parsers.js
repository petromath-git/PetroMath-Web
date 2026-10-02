// utils/pdf-statement-parsers.js
//
// Bank statements that only come as PDF are turned into the same row/column
// grid the Excel uploads produce, so the template-driven parsing in
// transaction-upload-controller.js handles them unchanged.
//
// PDF layout is bank-specific, so each bank gets its own parser, picked by
// the template's bank_name (see PARSERS below). Every parser returns rows
// laid out as:
//   A = Txn Date (DD/MM/YYYY), B = Description, C = Value Date (DD/MM/YYYY),
//   D = Reference, E = Debit, F = Credit, G = Balance
// under a header row, so every PDF template uses header_row 1,
// data_start_row 2, date_format DD/MM/YYYY and those column letters.
//
// Every parser checks each row's balance against the previous one and
// refuses the file on a mismatch — a misread layout must never import
// wrong amounts.

// pdf.js as bundled with pdf-parse — used directly because pdf-parse itself
// can't pass a password for protected statements (e.g. HDFC).
const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

const GRID_HEADER = ['Txn Date', 'Description', 'Value Date', 'Reference', 'Debit', 'Credit', 'Balance'];

const AMOUNT_RE = /^-?[\d,]+\.\d{2}$/;

class PdfPasswordError extends Error {
    constructor(errorType, message) {
        super(message);
        this.errorType = errorType;
    }
}

function isPdfFile(buffer) {
    return buffer.length >= 5 && buffer.slice(0, 5).toString('latin1') === '%PDF-';
}

function toNumber(s) {
    return parseFloat(String(s).replace(/,/g, '')) || 0;
}

function plainAmount(s) {
    return String(s).replace(/,/g, '').trim();
}

// Returns pages → lines → cells. Text items on the same y position form one
// line, in content-stream order (the same grouping pdf-parse uses). Cell
// strings are left untrimmed: some banks hard-wrap mid-word and the trailing
// space is what tells a word break apart.
async function loadPdfPages(buffer, password) {
    let doc;
    try {
        doc = await PDFJS.getDocument({ data: new Uint8Array(buffer), password: password || '' });
    } catch (e) {
        if (e && e.name === 'PasswordException') {
            if (!password) {
                throw new PdfPasswordError('PASSWORD_REQUIRED',
                    'This file is password-protected. Please enter the file password and try again.');
            }
            throw new PdfPasswordError('PASSWORD_INCORRECT',
                'The file password is incorrect. Please check it and try again.');
        }
        throw e;
    }

    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const lines = [];
        let lastY;
        for (const item of content.items) {
            const y = item.transform[5];
            if (lastY === undefined || y !== lastY) lines.push([]);
            lines[lines.length - 1].push(item.str);
            lastY = y;
        }
        pages.push(lines);
    }
    doc.destroy();
    return pages;
}

// Splits one amount into debit/credit by how it moved the running balance.
// Used for banks whose PDF text doesn't say which column the amount sat in.
function splitByBalance(amount, balance, prevBalance, context) {
    const amt = toNumber(amount);
    const bal = toNumber(balance);
    if (Math.abs(prevBalance - amt - bal) < 0.005) return { debit: plainAmount(amount), credit: '' };
    if (Math.abs(prevBalance + amt - bal) < 0.005) return { debit: '', credit: plainAmount(amount) };
    throw new Error(`Running balance does not reconcile on ${context}: previous ${prevBalance.toFixed(2)}, amount ${amt.toFixed(2)}, statement shows ${bal.toFixed(2)}`);
}

function assertBalanceChain(rows, openingBalance) {
    let prev = openingBalance;
    for (const r of rows) {
        const balance = toNumber(r[6]);
        if (prev !== null) {
            const expected = prev - toNumber(r[4]) + toNumber(r[5]);
            if (Math.abs(expected - balance) > 0.005) {
                throw new Error(`Running balance does not reconcile on ${r[0]} (${r[1]}): expected ${expected.toFixed(2)}, statement shows ${balance.toFixed(2)}`);
            }
        }
        prev = balance;
    }
}

// ========== Dhanlaxmi Bank ==========
// Each transaction is emitted as:
//   <description, one or more lines>
//   DD/MM/YYYY            (txn date)
//   DD/MM/YYYY            (value date)
//   <RefNo, zero or more lines — long refs wrap, "0" means none>
//   Balance :  48,887.61
//    5.90 Dr
// Every page repeats the column header ending in "Txn Amount"; the page
// footer and closing summary follow the last transaction on a page and are
// dropped when the next header or date pair starts.
function parseDhanlaxmi(pages) {
    const lines = pages.flat().map(cells => cells.join('').trim()).filter(Boolean);
    const dateRe = /^\d{2}\/\d{2}\/\d{4}$/;
    const balanceRe = /^Balance\s*:\s*(-?[\d,]+\.\d{2})$/;
    const amountRe = /^([\d,]+\.\d{2})\s*(Dr|Cr)$/;

    const rows = [];
    let descLines = [];
    let collecting = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line === 'Txn Amount') {
            descLines = [];
            collecting = true;
            continue;
        }

        if (collecting && dateRe.test(line) && dateRe.test(lines[i + 1] || '')) {
            const txnDate = line;
            const valueDate = lines[i + 1];
            let j = i + 2;
            const refParts = [];
            while (j < lines.length && !balanceRe.test(lines[j])) {
                refParts.push(lines[j]);
                j++;
            }
            const balMatch = balanceRe.exec(lines[j] || '');
            const amtMatch = amountRe.exec(lines[j + 1] || '');
            if (!balMatch || !amtMatch || refParts.length > 3) {
                throw new Error(`Unrecognised transaction layout near "${txnDate} — ${descLines.join(' ')}"`);
            }

            const ref = refParts.join('');
            const amount = plainAmount(amtMatch[1]);
            rows.push([
                txnDate,
                descLines.join(' '),
                valueDate,
                ref === '0' ? '' : ref,
                amtMatch[2] === 'Dr' ? amount : '',
                amtMatch[2] === 'Cr' ? amount : '',
                plainAmount(balMatch[1])
            ]);

            descLines = [];
            i = j + 1;
            continue;
        }

        if (collecting) descLines.push(line);
    }

    const openingIdx = lines.indexOf('Opening Balance');
    const opening = openingIdx >= 0 && AMOUNT_RE.test(lines[openingIdx + 1] || '')
        ? toNumber(lines[openingIdx + 1])
        : null;
    assertBalanceChain(rows, opening);
    return rows;
}

// ========== HDFC Bank ==========
// Each transaction starts with one line of cells:
//   DD/MM/YY | narration | Chq./Ref.No. | DD/MM/YY | amount | closing balance
// followed by narration continuation lines (hard-wrapped mid-word, so they
// are joined without a separator — this can carry over a page break). The
// line only has one amount and no Dr/Cr marker, so the direction comes from
// the balance movement, starting at the STATEMENT SUMMARY opening balance.
// Everything on a page from "Page No" / "STATEMENT SUMMARY" onwards is the
// address block or summary, not table text.
function parseHdfc(pages) {
    const dateRe = /^\d{2}\/\d{2}\/\d{2}$/;
    const toYyyy = d => `${d.slice(0, 6)}20${d.slice(6)}`;

    let opening = null;
    const txns = [];
    let current = null;

    for (const lines of pages) {
        let inTable = true;
        for (let i = 0; i < lines.length; i++) {
            const cells = lines[i];
            const first = cells[0].trim();

            if (first.startsWith('Opening Balance')) {
                const next = lines[i + 1] || [];
                if (AMOUNT_RE.test((next[0] || '').trim())) opening = toNumber(next[0]);
            }
            if (first.startsWith('Page No') || first.startsWith('STATEMENT SUMMARY')) inTable = false;
            if (!inTable || first === 'Date') continue;

            if (dateRe.test(first)) {
                const c = cells.map(s => s.trim());
                if (c.length !== 6 || !dateRe.test(c[3]) || !AMOUNT_RE.test(c[4]) || !AMOUNT_RE.test(c[5])) {
                    throw new Error(`Unrecognised transaction layout on ${first}: "${c.join(' | ')}"`);
                }
                current = { date: toYyyy(c[0]), narration: cells[1], ref: c[2], valueDate: toYyyy(c[3]), amount: c[4], balance: c[5] };
                txns.push(current);
            } else if (current) {
                current.narration += cells.join('');
            }
        }
    }

    if (opening === null) throw new Error('Opening balance not found in the statement summary');

    let prev = opening;
    return txns.map(t => {
        const { debit, credit } = splitByBalance(t.amount, t.balance, prev, `${t.date} (${t.narration.trim()})`);
        prev = toNumber(t.balance);
        return [t.date, t.narration.replace(/\s+/g, ' ').trim(), t.valueDate, t.ref, debit, credit, plainAmount(t.balance)];
    });
}

// ========== SBI (account statement PDF, e.g. EDFS dealer finance) ==========
// Each transaction starts with a line "DD/MM/YYYY | DD/MM/YYYY | description…"
// and runs over several lines (description and Ref No. text interleave line
// by line). It ends on the line whose last cell is the balance:
//   … | branch code | debit | credit | balance
// where the empty side is a blank cell. Balances can be negative (OD/loan
// accounts). Direction comes from the balance movement, starting at
// "Opening Balance as on <date> : <amount>". Page header/footer lines only
// appear between transactions and are ignored there.
function parseSbi(pages) {
    const dateRe = /^\d{2}\/\d{2}\/\d{4}$/;
    const lines = pages.flat();

    let opening = null;
    const txns = [];
    let current = null;

    for (const cells of lines) {
        const c = cells.map(s => s.trim()).filter(Boolean);
        if (c.length === 0) continue;

        if (opening === null && /^Opening Balance as on/i.test(c[0])) {
            const m = /(-?[\d,]+\.\d{2})\s*$/.exec(c.join(' '));
            if (m) opening = toNumber(m[1]);
            continue;
        }

        if (!current) {
            if (dateRe.test(c[0]) && dateRe.test(c[1] || '')) {
                current = { date: c[0], valueDate: c[1], text: [] };
                c.splice(0, 2);
            } else {
                continue; // header/footer text between transactions
            }
        }

        const last = c[c.length - 1];
        if (c.length >= 2 && AMOUNT_RE.test(last) && AMOUNT_RE.test(c[c.length - 2])) {
            // Closing line: [text…, branch code, amount, balance]
            current.amount = c[c.length - 2];
            current.balance = last;
            current.text.push(...c.slice(0, -3));
            txns.push(current);
            current = null;
        } else {
            current.text.push(...c);
        }
    }

    if (current) throw new Error(`Transaction on ${current.date} has no balance line`);
    if (opening === null) throw new Error('"Opening Balance as on" not found in the statement');

    let prev = opening;
    return txns.map(t => {
        const description = t.text.filter(s => s !== '/').join(' ').replace(/\s+/g, ' ').trim();
        const { debit, credit } = splitByBalance(t.amount, t.balance, prev, `${t.date} (${description})`);
        prev = toNumber(t.balance);
        return [t.date, description, t.valueDate, '', debit, credit, plainAmount(t.balance)];
    });
}

// Keyed by m_bank_statement_template.bank_name (upper-cased).
const PARSERS = {
    'DHANLAXMI': parseDhanlaxmi,
    'HDFC PDF': parseHdfc,
    'SBI PDF': parseSbi
};

function getPdfParser(bankName) {
    return PARSERS[String(bankName || '').trim().toUpperCase()] || null;
}

// Returns the grid (header row + one row per transaction).
// Throws PdfPasswordError (with errorType) for a missing/wrong password, or a
// plain Error if the bank has no PDF parser or the layout can't be read.
async function parsePdfStatementToData(buffer, bankName, password) {
    const parser = getPdfParser(bankName);
    if (!parser) {
        throw new Error(`PDF statements are not supported for ${bankName}. Please upload the Excel statement.`);
    }
    const pages = await loadPdfPages(buffer, password);
    return [GRID_HEADER, ...parser(pages)];
}

module.exports = { isPdfFile, getPdfParser, parsePdfStatementToData, PdfPasswordError };
