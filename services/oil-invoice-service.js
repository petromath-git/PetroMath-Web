// services/oil-invoice-service.js — IOCL charge invoices register (tkt #484).
//
// Upload one or more invoice PDFs -> read each -> check it belongs to this bunk -> save the new
// ones with the PDF -> link each to the SAP debit it pays for. Nothing here posts accounting:
// the SAP debit itself stays what books the charge (its GST is not claimed, see the migration).
//
// Linking runs after every save and on every page load, so an invoice uploaded before its SAP
// statement (or the other way round) links up by itself once both are in:
//   SAP_REF  LFR: the SAP invoice number is in the SAP narration ("7005878697 ': LICENSE FEE ...")
//   AMOUNT   others: a free SAP debit of the same amount whose narration matches the charge
//            type, from 10 days before to 60 days after the invoice date, nearest first
//   NONE     VMUS: deducted from the tank truck freight payment, never on the SAP account
const OilInvoiceDao = require('../dao/oil-invoice-dao');
const MailboxDao = require('../dao/oil-invoice-mailbox-dao');
const GstConfigDao = require('../dao/gst-config-dao');
const { parseOilChargeInvoice } = require('./oil-charge-invoice-parser');

const IOCL_PAN = 'AAACI1681G';
const MAX_FILES = 40;

const safeRegex = (p) => {
    try { return p ? new RegExp(p, 'i') : null; } catch (e) { return null; }
};

// Charge type of a parsed invoice: LFR by layout, others by the service head / description.
function chargeTypeOf(parsed, types) {
    if (parsed.template === 'LFR') return types.find(t => t.charge_code === 'LFR') || null;
    const text = `${parsed.service_head || ''} ${parsed.description || ''}`;
    const hit = types.find(t => t.charge_code !== 'LFR' && t.charge_code !== 'OTHER' && safeRegex(t.invoice_pattern) && safeRegex(t.invoice_pattern).test(text));
    return hit || types.find(t => t.charge_code === 'OTHER') || null;
}

// Charge type of a SAP narration (for the SAP Charges tab).
function chargeTypeOfNarration(remarks, types) {
    return types.find(t => safeRegex(t.sap_pattern) && safeRegex(t.sap_pattern).test(remarks || '')) || null;
}

function combinedSapPattern(types) {
    const parts = types.map(t => t.sap_pattern).filter(p => p && safeRegex(p));
    return parts.length ? parts.map(p => `(${p})`).join('|') : '^$';
}

const normName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// IOCL bunks sharing a GSTIN (the "GST INVOICE" layout has no customer code): which one an invoice is
// for, by the recipient name IOCL prints ("MUTHU CORPORATION" / "MUTHU CORPORATION UNIT II"). The names
// come from each bunk's LFR invoices, where the payer code proves the bunk. Returns { location, reason }.
// A name that begins another bunk's longer name counts only once that other bunk has a non-LFR invoice
// under its longer name: proof that IOCL prints the full name on this layout too.
async function bunkByName(parsed, candidates) {
    const printed = normName(parsed.recipient_name);
    const rows = (await OilInvoiceDao.getRecipientNames(candidates)).map(r => ({ ...r, name: normName(r.recipient_name) }));
    const lfrNames = new Map(candidates.map(loc => [loc, new Set(rows.filter(r => r.location_code === loc && Number(r.is_lfr)).map(r => r.name))]));
    const without = candidates.filter(loc => !lfrNames.get(loc).size);
    if (without.length) return { location: null, reason: `No LFR invoice of ${without.join(', ')} is in PetroMath yet, so the name on the invoice cannot be checked.` };
    const hits = printed ? candidates.filter(loc => lfrNames.get(loc).has(printed)) : [];
    if (hits.length !== 1) return { location: null, reason: `The name on the invoice (${parsed.recipient_name || 'none'}) does not point to one bunk.` };
    for (const other of candidates.filter(loc => loc !== hits[0])) {
        const longer = [...lfrNames.get(other)].filter(n => n.startsWith(printed + ' '));
        if (longer.length && !rows.some(r => r.location_code === other && !Number(r.is_lfr) && longer.includes(r.name))) {
            return { location: null, reason: `The name on the invoice (${parsed.recipient_name}) is ${hits[0]}'s, but ${other} has no invoice of this kind under its own name yet, so the two cannot be told apart.` };
        }
    }
    return { location: hits[0] };
}

// Reads every file and works out what would be saved. Returns
// { account, files: [{ file_name, status, error, problems[], warnings[], charge_code, charge_name, invoice }] }
// status: NEW, EXISTS (already uploaded, or twice in this upload), BLOCKED (see problems), ERROR (unreadable).
async function buildFromFiles(locationCode, files) {
    const [types, account, gstConfig] = await Promise.all([
        OilInvoiceDao.getChargeTypes(),
        OilInvoiceDao.getIoclAccount(locationCode),
        GstConfigDao.findByLocationCode(locationCode),
    ]);
    const ownGstin = gstConfig ? String(gstConfig.gstin || '').trim().toUpperCase() : '';
    const acctPayer = account && /(\d{5,8})$/.exec(String(account.account_number || '').trim());

    // IOCL bunks on this bunk's GSTIN (itself included)
    let sharing = [];
    if (ownGstin) {
        const same = (await GstConfigDao.findAllActive()).filter(c => String(c.gstin || '').trim().toUpperCase() === ownGstin).map(c => c.location_code);
        if (same.length > 1) sharing = (await MailboxDao.getIoclLocations(same)).map(r => r.location_code);
    }

    const out = [];
    for (const f of files.slice(0, MAX_FILES)) {
        const r = { file_name: f.originalname, status: 'NEW', error: null, problems: [], warnings: [], invoice: null };
        try {
            const p = await parseOilChargeInvoice(f.buffer);
            const type = chargeTypeOf(p, types);
            r.invoice = p;
            r.charge_code = type ? type.charge_code : null;
            r.charge_name = type ? type.charge_name : null;
            r.warnings.push(...p.warnings);
            if (!type) r.problems.push('Charge types are not set up (m_oil_charge_type).');
            if (!p.supplier_gstin || !p.supplier_gstin.includes(IOCL_PAN)) {
                r.problems.push(`Issued by GSTIN ${p.supplier_gstin || '(not found)'}, which is not Indian Oil's.`);
            }
            if (ownGstin && p.recipient_gstin && p.recipient_gstin !== ownGstin) {
                r.problems.push(`This invoice is for GSTIN ${p.recipient_gstin}${p.recipient_name ? ' (' + p.recipient_name + ')' : ''}, but ${locationCode}'s GSTIN is ${ownGstin}. Upload it at the bunk it belongs to.`);
            } else if (!ownGstin) {
                r.warnings.push(`${locationCode} has no GSTIN set up, so the invoice's GSTIN (${p.recipient_gstin || '?'}) could not be checked.`);
            }
            if (p.payer_code && acctPayer && acctPayer[1] !== p.payer_code && !String(account.account_number).endsWith(p.payer_code)) {
                r.problems.push(`This LFR invoice is for IOCL customer ${p.payer_code}, but ${locationCode}'s SAP account is ${account.account_number}. Upload it at the bunk it belongs to.`);
            }
            if (!p.payer_code && p.recipient_gstin === ownGstin && sharing.length > 1 && sharing.includes(locationCode)) {
                const named = await bunkByName(p, sharing);
                if (named.location && named.location !== locationCode) {
                    r.problems.push(`This invoice is made out to ${p.recipient_name}, which is ${named.location}. Upload it there.`);
                }
            }
            if (type && type.charge_code === 'OTHER') {
                r.warnings.push(`"${p.service_head}" is not a known charge type; it is saved as "${type.charge_name}" and linked by amount and date only.`);
            }
            if (p.invoice_no.length > 30) r.problems.push(`Invoice number ${p.invoice_no} is too long.`);
        } catch (e) {
            r.status = 'ERROR';
            r.error = e.message || 'Could not read the file.';
        }
        out.push(r);
    }

    const nos = out.filter(r => r.invoice).map(r => r.invoice.invoice_no);
    const existing = await OilInvoiceDao.getExistingInvoiceNos(locationCode, nos);
    const seen = new Set();
    for (const r of out) {
        if (r.status === 'ERROR') continue;
        const no = r.invoice.invoice_no;
        if (existing.has(no) || seen.has(no)) r.status = 'EXISTS';
        else if (r.problems.length) r.status = 'BLOCKED';
        seen.add(no);
    }
    return { account, files: out, skippedFiles: Math.max(0, files.length - MAX_FILES) };
}

// Saves the NEW invoices of the upload, then links them. Returns { saved: [no], skipped: [{ file, reason }], linked }.
async function saveFiles(locationCode, files, by) {
    const built = await buildFromFiles(locationCode, files);
    if (!built.account) {
        const e = new Error(`${locationCode} has no IOCL SAP account (Masters > Oil Company Accounts), so IOCL invoices cannot be kept here.`);
        e.userFacing = true;
        throw e;
    }
    const saved = [], skipped = [];
    const byName = new Map(files.map(f => [f.originalname, f]));
    for (const r of built.files) {
        if (r.status !== 'NEW') {
            skipped.push({ file: r.file_name, reason: r.status === 'EXISTS' ? 'already uploaded' : (r.error || r.problems.join(' ')) });
            continue;
        }
        const p = r.invoice;
        const inv = {
            location_code: locationCode, oil_company: 'IOCL', charge_code: r.charge_code, invoice_no: p.invoice_no,
            sap_ref: p.sap_ref, invoice_date: p.invoice_date,
            description: [p.service_head, p.template === 'LFR' ? null : p.description].filter(Boolean).join(' · ').substring(0, 200) || null,
            sac_code: p.sac_code, supplier_gstin: p.supplier_gstin, recipient_gstin: p.recipient_gstin,
            recipient_name: p.recipient_name ? p.recipient_name.substring(0, 200) : null,
            taxable_value: p.taxable_value, cgst_amount: p.cgst_amount, sgst_amount: p.sgst_amount, igst_amount: p.igst_amount,
            cess_amount: p.cess_amount || 0, total_amount: p.total_amount, total_kl: p.total_kl,
            file_name: String(r.file_name || '').substring(0, 200), created_by: by, updated_by: by
        };
        const f = byName.get(r.file_name);
        try {
            await OilInvoiceDao.createInvoice(inv, p.lines, f ? { buffer: f.buffer, file_name: `${p.invoice_no}.pdf` } : null);
            saved.push(p.invoice_no);
        } catch (e) {
            if (e.parent && e.parent.code === 'ER_DUP_ENTRY') skipped.push({ file: r.file_name, reason: 'already uploaded' });
            else throw e;
        }
    }
    const linked = await linkPending(locationCode, by);
    return { saved, skipped, linked };
}

// Links every unlinked invoice of the location to its SAP debit, if the SAP statement has it.
// IOCL debits a charge the day it raises the invoice, so same-day debits are taken first for
// every invoice; only then a short window around the date. (One pass with a wide window let an
// invoice whose debit is missing take next month's debit, and the next invoice the one after.)
const WINDOWS = [[0, 0], [5, 20]];
async function linkPending(locationCode, by) {
    const account = await OilInvoiceDao.getIoclAccount(locationCode);
    if (!account) return 0;
    let linked = 0;
    const tryLink = async (inv, tBankId, method) => {
        if (tBankId && await OilInvoiceDao.linkSapDebit(inv.invoice_id, tBankId, method, by || 'system')) { linked++; return true; }
        return false;
    };
    let pending = await OilInvoiceDao.getUnlinkedInvoices(locationCode);
    for (const inv of pending.filter(i => i.match_by === 'SAP_REF' && i.sap_ref)) {
        await tryLink(inv, await OilInvoiceDao.findSapDebitByRef(account.bank_id, inv.sap_ref), 'SAP_REF');
    }
    for (const [before, after] of WINDOWS) {
        pending = await OilInvoiceDao.getUnlinkedInvoices(locationCode);
        for (const inv of pending) {
            const tBankId = await OilInvoiceDao.findSapDebitByAmount(account.bank_id, Number(inv.total_amount), inv.invoice_date,
                inv.charge_code === 'OTHER' ? null : inv.sap_pattern, before, after);
            await tryLink(inv, tBankId, 'AMOUNT');
        }
    }
    return linked;
}

// SAP Charges tab: charge debits on the IOCL account, each with its charge type and invoice.
async function getSapCharges(locationCode, fromDate, toDate) {
    const [types, account] = await Promise.all([OilInvoiceDao.getChargeTypes(), OilInvoiceDao.getIoclAccount(locationCode)]);
    if (!account) return { rows: [], summary: [] };
    const rows = await OilInvoiceDao.getSapCharges(account.bank_id, fromDate, toDate, combinedSapPattern(types));
    const byCode = new Map();
    rows.forEach(r => {
        const t = (r.invoice_charge_code && types.find(x => x.charge_code === r.invoice_charge_code)) || chargeTypeOfNarration(r.remarks, types);
        r.charge_code = t ? t.charge_code : 'OTHER';
        r.charge_name = t ? t.charge_name : 'Other';
        const s = byCode.get(r.charge_code) || { charge_code: r.charge_code, charge_name: r.charge_name, count: 0, amount: 0, withInvoice: 0, missing: 0, missingAmount: 0 };
        s.count++; s.amount += Number(r.debit_amount);
        if (r.invoice_id) s.withInvoice++; else { s.missing++; s.missingAmount += Number(r.debit_amount); }
        byCode.set(r.charge_code, s);
    });
    const order = types.map(t => t.charge_code);
    const summary = Array.from(byCode.values()).sort((a, b) => order.indexOf(a.charge_code) - order.indexOf(b.charge_code));
    return { rows, summary };
}

// yyyy-mm-dd helpers (calendar dates, no time zone)
const isoAddDays = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
const isoMinusMonth = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

// LFR Check tab. Per LFR invoice: each fuel invoice it charges, found (or not) in Tank Receipts;
// and the IOCL fuel invoices in Tank Receipts dated in its period that no LFR invoice lists.
async function getLfrCheck(locationCode, fromDate, toDate) {
    const account = await OilInvoiceDao.getIoclAccount(locationCode);
    const rows = await OilInvoiceDao.getLfrPurchaseCheck(locationCode, fromDate, toDate);
    const tank = await OilInvoiceDao.getTankInvoicesByIds(Array.from(new Set(rows.map(r => r.tank_invoice_id).filter(Boolean))));
    const tankById = new Map(tank.map(t => [t.id, t]));
    const invoices = [];
    for (const r of rows) {
        let inv = invoices.find(x => x.invoice_id === r.invoice_id);
        if (!inv) {
            inv = { invoice_id: r.invoice_id, invoice_no: r.invoice_no, lfr_date: r.lfr_date,
                period_from: isoMinusMonth(r.lfr_date), period_to: isoAddDays(r.lfr_date, -1),
                purchases: [], missing: 0, klDiff: 0, notOnLfr: [] };
            invoices.push(inv);
        }
        const t = r.tank_invoice_id ? tankById.get(r.tank_invoice_id) : null;
        const lfrKl = Number(r.lfr_kl || 0), tankKl = t ? Number(t.kl || 0) : null;
        const p = { ...r, lfr_kl: lfrKl, lfr_amount: Number(r.lfr_amount), tank: t, tank_kl: tankKl,
            status: !t ? 'MISSING' : (Math.abs(tankKl - lfrKl) > 0.001 ? 'KL_DIFF' : 'OK') };
        if (p.status === 'MISSING') inv.missing++;
        if (p.status === 'KL_DIFF') inv.klDiff++;
        inv.purchases.push(p);
    }
    if (account) {
        for (const inv of invoices) {
            const inPeriod = await OilInvoiceDao.getTankInvoicesInPeriod(locationCode, account.supplier_id, inv.period_from, inv.period_to);
            inv.notOnLfr = inPeriod.filter(t => !Number(t.on_lfr));
        }
    }
    return { invoices };
}

module.exports = { bunkByName, buildFromFiles, saveFiles, linkPending, getSapCharges, getLfrCheck, chargeTypeOf, MAX_FILES };
