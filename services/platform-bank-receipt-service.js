// services/platform-bank-receipt-service.js
//
// Records subscription receipts from PetroMath's own IOB statement (tkt #459).
// A credit line is tagged to the location that paid, which either creates a
// platform payment or connects the line to one already entered by hand.
// No ledgers or accounting: the parser is its own too, so the location bank
// upload (transaction-upload-controller) is neither used nor affected.
const crypto = require('crypto');
const XLSX = require('xlsx');
const dateFormat = require('dateformat');
const Dao = require('../dao/platform-bank-receipt-dao');
const PlatformBillingSvc = require('./platform-billing-service');

// A hand-entered payment is offered as a match only within this many days.
// Those dates are approximate (many past GPay receipts were entered as the 5th).
const MATCH_WINDOW_DAYS = 10;
const MIN_ALIAS_LENGTH = 4;
const PAISA = 0.005;

function normalizeText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function parseAmount(raw) {
    if (raw === null || raw === undefined) return 0;
    return Math.abs(parseFloat(String(raw).replace(/,/g, '').trim())) || 0;
}

// DD/MM/YYYY, as IOB writes it. Anything else returns null: guessing day vs
// month here would record a receipt on the wrong date.
function parseIobDate(raw) {
    const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Pulls the reference and payer out of an IOB narration:
//   UPI/630275111169/CR/PAYER NAME/BANK/...
//   NEFT-YESB-YESBN62826206013-PAYER NAME-...
function parseNarration(description) {
    const text = String(description || '').trim();
    const clean = s => (s || '').replace(/\s+/g, ' ').trim() || null;

    if (/^UPI\//i.test(text)) {
        const parts = text.split('/');
        const hasDirection = /^(CR|DR)$/i.test((parts[2] || '').trim());
        return { mode: 'MANUAL_UPI', reference: clean(parts[1]), payer: clean(hasDirection ? parts[3] : parts[2]) };
    }
    if (/^(NEFT|RTGS|IMPS)-/i.test(text)) {
        const parts = text.split('-');
        return { mode: 'MANUAL_BANK', reference: clean(parts[2]), payer: clean(parts[3]) };
    }
    return { mode: 'MANUAL_BANK', reference: null, payer: null };
}

/**
 * Reads the credit lines of an IOB statement. Columns are found by their
 * heading, since IOB has already moved the header row once (Sep 2026).
 * Throws rather than silently dropping a line it can't read.
 */
function parseStatement(buffer) {
    let rows;
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false });
    } catch (err) {
        throw new Error('Could not read this file. Please upload the Excel statement downloaded from IOB.');
    }

    const headerIndex = rows.findIndex(r => {
        const cells = (r || []).map(c => String(c || '').trim().toLowerCase());
        return cells.includes('date') && cells.includes('credit') && cells.includes('debit') && cells.includes('remarks');
    });
    if (headerIndex === -1) {
        throw new Error('This does not look like an IOB statement: no Date / Remarks / Debit / Credit heading found.');
    }

    const header = rows[headerIndex].map(c => String(c || '').trim().toLowerCase());
    const col = {
        date: header.indexOf('date'),
        chq: header.indexOf('chq'),
        remarks: header.indexOf('remarks'),
        debit: header.indexOf('debit'),
        credit: header.indexOf('credit'),
        balance: header.indexOf('balance')
    };

    const lines = [];
    const badDates = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.length) continue;

        const credit = parseAmount(row[col.credit]);
        const debit = parseAmount(row[col.debit]);
        if (credit <= 0 || debit > 0) continue; // debits, blanks and total rows

        const rawDate = row[col.date];
        const txnDate = parseIobDate(rawDate);
        if (!txnDate) {
            if (/\d/.test(String(rawDate || ''))) badDates.push(`row ${i + 1}: "${rawDate}"`);
            continue;
        }

        const description = String(row[col.remarks] || '').replace(/\s+/g, ' ').trim();
        const balance = col.balance >= 0 ? parseAmount(row[col.balance]) : 0;
        const narration = parseNarration(description);
        const chq = col.chq >= 0 ? String(row[col.chq] || '').trim() : '';

        lines.push({
            txn_date: txnDate,
            description: description.slice(0, 500),
            reference: (narration.reference || chq || '').slice(0, 100) || null,
            payer_name: narration.payer ? narration.payer.slice(0, 150) : null,
            credit_amount: credit,
            balance_amount: balance || null,
            // The running balance is what keeps two identical credits on one day apart
            dedup_key: crypto.createHash('sha1')
                .update([txnDate, credit.toFixed(2), balance.toFixed(2), normalizeText(description)].join('|'))
                .digest('hex')
        });
    }

    if (badDates.length) {
        throw new Error(`${badDates.length} credit line(s) have a date that is not DD/MM/YYYY (${badDates.slice(0, 3).join(', ')}). Nothing was uploaded.`);
    }
    return lines;
}

async function uploadStatement(file, userId) {
    const lines = parseStatement(file.buffer);
    if (!lines.length) {
        throw new Error('No credit lines found in this statement.');
    }
    return Dao.saveUpload(file.originalname, lines, userId);
}

function ymd(value) {
    if (value instanceof Date) return dateFormat(value, 'yyyy-mm-dd');
    return String(value).slice(0, 10);
}

function daysApart(a, b) {
    return Math.abs(new Date(ymd(a) + 'T00:00:00Z') - new Date(ymd(b) + 'T00:00:00Z')) / 86400000;
}

// The longest remembered text found in the narration wins
function locationFromAlias(line, aliases) {
    const narration = normalizeText(line.description);
    let best = null;
    for (const alias of aliases) {
        const text = normalizeText(alias.match_text);
        if (text && narration.includes(text) && (!best || text.length > normalizeText(best.match_text).length)) {
            best = alias;
        }
    }
    return best ? best.location_code : null;
}

/**
 * What to do with each untagged line, for the user to review. Oldest lines
 * pick first and a payment is offered to one line only.
 *  - Same reference as a payment, or same amount close by in date => link.
 *  - Remembered payer and nothing to link => new payment for that location.
 *  - Amount alone fits more than one location => no guess, the user picks
 *    (1,750 is several locations' monthly rate).
 * Returns Map(bank_txn_id => { location_code, payment_id|null, payment })
 */
function buildSuggestions(lines, payments, aliases) {
    const suggestions = new Map();
    const taken = new Set();

    for (const line of lines) {
        const aliasLocation = locationFromAlias(line, aliases);
        const amount = Number(line.credit_amount);
        const open = payments.filter(p => !taken.has(p.payment_id));
        const sameAmount = open.filter(p => Math.abs(Number(p.remaining) - amount) < PAISA);

        let match = line.reference
            ? sameAmount.find(p => p.reference_number && String(p.reference_number).trim() === line.reference)
            : null;

        if (!match) {
            const near = sameAmount.filter(p =>
                p.payment_mode !== 'MANUAL_CASH'
                && daysApart(p.payment_date, line.txn_date) <= MATCH_WINDOW_DAYS
                && (!aliasLocation || p.location_code === aliasLocation)
            );
            const locations = new Set(near.map(p => p.location_code));
            if (locations.size === 1) {
                match = near.sort((a, b) =>
                    daysApart(a.payment_date, line.txn_date) - daysApart(b.payment_date, line.txn_date))[0];
            }
        }

        if (match) {
            taken.add(match.payment_id);
            suggestions.set(line.bank_txn_id, { location_code: match.location_code, payment_id: match.payment_id, payment: match });
        } else if (aliasLocation) {
            suggestions.set(line.bank_txn_id, { location_code: aliasLocation, payment_id: null, payment: null });
        }
    }
    return suggestions;
}

async function getSuggestions() {
    const [lines, payments, aliases] = await Promise.all([
        Dao.findUntaggedOldestFirst(),
        Dao.findUnlinkedPayments(),
        Dao.findAliases()
    ]);
    return { lines, payments, suggestions: buildSuggestions(lines, payments, aliases) };
}

/**
 * Tag one credit line to a location. paymentIds are hand-entered payments this
 * line is connecting to; whatever they don't cover becomes a new payment,
 * allocated to the location's oldest unpaid invoices.
 */
async function tagLine(bankTxnId, { locationCode, paymentIds = [], rememberText }, userId) {
    if (!locationCode) throw new Error('Please choose the location that paid.');

    const line = await Dao.findLine(bankTxnId);
    if (!line) throw new Error('Statement line not found.');

    const claimed = await Dao.setLineStatus(bankTxnId, 'UNTAGGED', 'TAGGED', locationCode, userId);
    if (!claimed) throw new Error('This line has already been tagged. Please refresh the page.');

    try {
        let left = Number(line.credit_amount);

        await Dao.transaction(async (t) => {
            for (const paymentId of paymentIds) {
                const payment = await Dao.findPaymentRemainingForUpdate(paymentId, t);
                if (!payment) throw new Error(`Payment #${paymentId} not found.`);
                if (payment.location_code !== locationCode) {
                    throw new Error(`Payment #${paymentId} belongs to ${payment.location_code}, not ${locationCode}.`);
                }
                const amount = Math.min(left, payment.remaining);
                if (amount < PAISA) {
                    throw new Error(`Nothing left to connect on payment #${paymentId}: this line is already covered, or the payment is.`);
                }
                await Dao.addLink(bankTxnId, paymentId, amount, false, userId, t);
                left = Math.round((left - amount) * 100) / 100;
            }
        });

        if (left >= PAISA) {
            const narration = parseNarration(line.description);
            const payment = await PlatformBillingSvc.recordBulkPayment({
                location_code: locationCode,
                payment_date: ymd(line.txn_date),
                amount: left,
                payment_mode: narration.mode,
                reference_number: line.reference,
                remarks: 'From bank statement',
                created_by: userId
            });
            await Dao.transaction(t => Dao.addLink(bankTxnId, payment.payment_id, left, true, userId, t));
        }
    } catch (err) {
        await Dao.transaction(t => Dao.deleteLinks(bankTxnId, t));
        await Dao.setLineStatus(bankTxnId, 'TAGGED', 'UNTAGGED', null, userId);
        throw err;
    }

    const text = normalizeText(rememberText);
    if (text.length >= MIN_ALIAS_LENGTH) {
        await Dao.saveAlias(text.slice(0, 150), locationCode, userId, true);
    }
}

/**
 * Applies the suggestions for the ticked lines. Suggestions are worked out
 * again here, so what's applied always reflects the current data. Each line
 * stands alone: one failure doesn't stop the rest.
 */
async function applySuggestions(bankTxnIds, userId) {
    const wanted = new Set(bankTxnIds.map(Number));
    const { lines, suggestions } = await getSuggestions();

    const result = { linked: 0, created: 0, failed: [] };
    for (const line of lines) {
        const suggestion = suggestions.get(line.bank_txn_id);
        if (!wanted.has(line.bank_txn_id) || !suggestion) continue;
        try {
            await tagLine(line.bank_txn_id, {
                locationCode: suggestion.location_code,
                paymentIds: suggestion.payment_id ? [suggestion.payment_id] : []
            }, userId);
            result[suggestion.payment_id ? 'linked' : 'created']++;
            if (line.payer_name && normalizeText(line.payer_name).length >= MIN_ALIAS_LENGTH) {
                await Dao.saveAlias(normalizeText(line.payer_name).slice(0, 150), suggestion.location_code, userId, false);
            }
        } catch (err) {
            console.error('PlatformBankReceiptService.applySuggestions:', err);
            result.failed.push(`Line ${line.bank_txn_id}: ${err.message}`);
        }
    }
    return result;
}

/**
 * Puts a line back to untagged. A hand-entered payment just loses the link. A
 * payment this line created is removed with its allocations, and the invoices
 * it had paid go back to unpaid.
 */
async function undoLine(bankTxnId, userId) {
    const line = await Dao.findLine(bankTxnId);
    if (!line) throw new Error('Statement line not found.');
    if (line.status === 'IGNORED') {
        await Dao.setLineStatus(bankTxnId, 'IGNORED', 'UNTAGGED', null, userId);
        return;
    }
    if (line.status !== 'TAGGED') return;

    const links = await Dao.findLinks(bankTxnId);
    const created = links.filter(l => l.created_payment);

    for (const link of created) {
        if (await Dao.countPaidCommissions(link.payment_id)) {
            throw new Error(`Payment #${link.payment_id} has distributor commission already paid out, so it can't be undone here.`);
        }
    }

    const invoiceIds = [];
    for (const link of created) {
        invoiceIds.push(...await Dao.findAllocatedInvoiceIds(link.payment_id));
    }

    await Dao.transaction(async (t) => {
        await Dao.deleteLinks(bankTxnId, t);
        for (const link of created) {
            await Dao.deletePayment(link.payment_id, t);
        }
    });
    await Dao.setLineStatus(bankTxnId, 'TAGGED', 'UNTAGGED', null, userId);

    for (const invoiceId of invoiceIds) {
        await PlatformBillingSvc.recalculateInvoiceStatus(invoiceId, userId);
    }
}

async function ignoreLine(bankTxnId, userId) {
    const changed = await Dao.setLineStatus(bankTxnId, 'UNTAGGED', 'IGNORED', null, userId);
    if (!changed) throw new Error('This line is no longer untagged. Please refresh the page.');
}

module.exports = {
    parseStatement,
    parseNarration,
    buildSuggestions,
    uploadStatement,
    getSuggestions,
    tagLine,
    applySuggestions,
    undoLine,
    ignoreLine
};
