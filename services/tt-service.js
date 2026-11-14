// services/tt-service.js — Tank Truck Freight: turns an uploaded freight-bill PDF into bills to save.
// Preview and save run the same checks on the same file, so nothing is kept between the two.
//
// Amounts per bill (vendor settings give the GST rate and TDS %):
//   taxable        = gross - penalty
//   CGST / SGST    = taxable x rate / 2 each (IGST if the bill printed IGST), rounded to paise:
//                    what GSTR-1 reports. The bill's own figures (sum of per-trip rounding,
//                    a few paise off) are kept as bill_cgst / bill_sgst.
//   TDS            = taxable x TDS %, rounded to the rupee (as IOCL deducts it)
//   net receivable = taxable - TDS (GST is paid by the oil company under reverse charge)
const TtDao = require('../dao/tt-dao');
const GstConfigDao = require('../dao/gst-config-dao');
const { parseIoclTransportBill } = require('./tt-invoice-parser');
const { parseXtrapowerStatement } = require('./xtrapower-statement-parser');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function computeAmounts(totals, gstRate, tdsPercent) {
    const taxable = r2(totals.gross - totals.penalty);
    const interstate = totals.igst > 0 && totals.cgst === 0;
    const igst = interstate ? r2(taxable * gstRate / 100) : 0;
    const half = interstate ? 0 : r2(taxable * gstRate / 200);
    const tds = Math.round(taxable * tdsPercent / 100);
    return {
        gross_amount: r2(totals.gross),
        penalty_amount: r2(totals.penalty),
        taxable_value: taxable,
        cgst_amount: half,
        sgst_amount: half,
        igst_amount: igst,
        bill_cgst: r2(totals.cgst),
        bill_sgst: r2(totals.sgst),
        bill_igst: r2(totals.igst),
        invoice_value: r2(taxable + half * 2 + igst),
        tds_percent: tdsPercent,
        tds_amount: tds,
        net_receivable: r2(taxable - tds)
    };
}

// Returns { header, vendor, bills: [{ ...row, lines, status, problems[] }], errors[], warnings[] }.
// status: NEW (will be saved), EXISTS (already uploaded), BEFORE_START (dated before the vendor's
// start date), BLOCKED (see problems). Throws only when the file can't be read at all.
async function buildFromPdf(locationCode, buffer, fileName) {
    const parsed = await parseIoclTransportBill(buffer);
    const h = parsed.header;
    const errors = [];
    const warnings = parsed.warnings.slice();

    const gstConfig = await GstConfigDao.findByLocationCode(locationCode);
    const ownGstin = gstConfig ? String(gstConfig.gstin || '').trim().toUpperCase() : '';
    if (!ownGstin) {
        errors.push('This location has no GSTIN set up (GST Returns > Settings), so the bill cannot be checked against it.');
    } else if (h.vendor_gstin !== ownGstin) {
        errors.push(`The bill is issued by GSTIN ${h.vendor_gstin} (${h.vendor_name || 'unknown'}), but this location's GSTIN is ${ownGstin}. Upload it at the location it belongs to.`);
    }

    const vendor = h.vendor_code ? await TtDao.getVendorByCode(locationCode, parsed.oil_company, h.vendor_code) : null;
    if (!vendor) {
        errors.push(`No active ${parsed.oil_company} transporter with vendor code ${h.vendor_code || '(none)'} is set up for ${locationCode}. Add it in Masters > Tank Truck Master.`);
    } else {
        if (!vendor.debtor_ledger_id || !vendor.income_ledger_id) warnings.push('The vendor has no debtor or income ledger set, so Create Accounting will fail on these bills until they are set in Tank Truck Master.');
        if (!vendor.tds_ledger_id && Number(vendor.tds_percent) > 0) warnings.push('The vendor has no TDS ledger set in Tank Truck Master.');
    }

    const existing = await TtDao.getExistingBillNos(locationCode, parsed.bills.map(b => b.bill_no));
    const startDate = vendor ? String(vendor.start_date instanceof Date ? vendor.start_date.toISOString().slice(0, 10) : vendor.start_date).slice(0, 10) : null;

    const bills = parsed.bills.map(b => {
        const amounts = computeAmounts(b.totals, vendor ? Number(vendor.gst_rate) : 5, vendor ? Number(vendor.tds_percent) : 0);
        const problems = [];
        let status = 'NEW';
        if (existing.has(b.bill_no)) status = 'EXISTS';
        else if (startDate && b.bill_date < startDate) status = 'BEFORE_START';
        if (b.bill_no.length > 16) problems.push(`Bill number ${b.bill_no} is longer than 16 characters; the GST portal will not take it.`);
        if (!h.recipient_gstin) problems.push('Recipient (IOCL terminal) GSTIN not found on the bill.');
        if (Math.abs(amounts.bill_cgst - amounts.cgst_amount) > 1 || Math.abs(amounts.bill_sgst - amounts.sgst_amount) > 1) {
            warnings.push(`Bill ${b.bill_no}: GST printed (${amounts.bill_cgst} + ${amounts.bill_sgst}) differs by more than ₹1 from ${vendor ? vendor.gst_rate : 5}% of the taxable value (${amounts.cgst_amount} + ${amounts.sgst_amount}). Check the GST rate in Tank Truck Master.`);
        }
        if (problems.length && status === 'NEW') status = 'BLOCKED';
        const vehicles = Array.from(new Set(b.lines.map(l => l.vehicle_no)));
        return {
            vendor_id: vendor ? vendor.vendor_id : null,
            bill_no: b.bill_no,
            bill_date: b.bill_date,
            period_from: h.period_from,
            period_to: h.period_to,
            generated_on: h.generated_on,
            reverse_charge: b.reverse_charge,
            recipient_name: h.recipient_name,
            recipient_gstin: h.recipient_gstin,
            recipient_address: h.recipient_address,
            sac_code: vendor ? vendor.sac_code : '996791',
            gst_rate: vendor ? Number(vendor.gst_rate) : 5,
            ...amounts,
            trip_count: b.lines.length,
            total_kl: Math.round(b.lines.reduce((s, l) => s + l.qty_kl, 0) * 1000) / 1000,
            vehicles: vehicles.join(', ').substring(0, 200),
            file_name: fileName ? String(fileName).substring(0, 200) : null,
            lines: b.lines,
            status,
            problems
        };
    });

    return { header: h, oil_company: parsed.oil_company, vendor, bills, errors, warnings };
}

// Saves the NEW bills of the file. Returns { saved: [bill_no], skipped: [{ bill_no, reason }] }.
async function saveFromPdf(locationCode, buffer, fileName, by) {
    const r = await buildFromPdf(locationCode, buffer, fileName);
    if (r.errors.length) {
        const e = new Error(r.errors.join(' '));
        e.userFacing = true;
        throw e;
    }
    const toSave = r.bills.filter(b => b.status === 'NEW');
    const skipped = r.bills.filter(b => b.status !== 'NEW').map(b => ({
        bill_no: b.bill_no,
        reason: b.status === 'EXISTS' ? 'already uploaded'
            : b.status === 'BEFORE_START' ? 'dated before the start date'
            : b.problems.join(' ')
    }));
    if (toSave.length) await TtDao.createInvoices(locationCode, toSave, by);
    return { saved: toSave.map(b => b.bill_no), skipped };
}

// ── XTRAPOWER fleet card statement ──────────────────────────────────────────
// Returns { summary, card, txns (with rupees), status, errors[], warnings[] }.
// status: NEW, EXISTS (this card + period already uploaded), BEFORE_START.
async function buildCardFromPdf(locationCode, buffer) {
    const parsed = await parseXtrapowerStatement(buffer);
    const s = parsed.summary;
    const errors = [];
    const warnings = parsed.warnings.slice();
    const card = await TtDao.getCardByCustomerId(locationCode, s.customer_id);
    if (!card) {
        errors.push(`XTRAPOWER customer ${s.customer_id} (${s.customer_name || ''}) is not set up as a fleet card for ${locationCode}. Add it in Masters > Tank Truck Master > Fleet Cards, or upload it at the location it belongs to.`);
    } else {
        if (!card.wallet_ledger_id || !card.points_ledger_id || !card.diesel_ledger_id || !card.loyalty_income_ledger_id) {
            warnings.push('Some ledgers are not set for this card in Tank Truck Master; Create Accounting will fail until they are.');
        }
        if (!card.vendor_id) warnings.push('The card is not linked to an oil company vendor, so recharges cannot clear the freight debtor.');
    }
    const ptsPerRupee = card ? Number(card.points_per_rupee) || 100 : 100;
    const txns = parsed.txns.map(t => ({
        ...t,
        rupees: /^(LOYALTY_)/.test(t.kind) ? r2(t.amount / ptsPerRupee) : t.amount
    }));

    let status = 'NEW';
    if (card) {
        const start = String(card.start_date instanceof Date ? card.start_date.toISOString().slice(0, 10) : card.start_date).slice(0, 10);
        if (await TtDao.getCardStatementByPeriod(card.card_id, s.period_from)) status = 'EXISTS';
        else if (s.period_from < start) status = 'BEFORE_START';
        if (status === 'NEW') {
            const prev = await TtDao.getPreviousCardStatement(card.card_id, s.period_from);
            if (prev && Math.abs(Number(prev.ccms_closing) - s.ccms.opening) > 0.01) {
                warnings.push(`Opening card balance ${s.ccms.opening.toFixed(2)} is not the previous statement's closing ${Number(prev.ccms_closing).toFixed(2)}. Is a month missing?`);
            }
        }
    }
    const veh = Array.from(new Set(txns.map(t => t.vehicle_no).filter(Boolean)));
    if (card && card.vehicle_id && veh.length) {
        const vehicles = await TtDao.getVehicles(locationCode);
        const own = (vehicles.find(v => v.vehicle_id === card.vehicle_id) || {}).vehicle_no;
        const others = veh.filter(v => v !== own);
        if (own && others.length) warnings.push(`Sales on other vehicles (${others.join(', ')}) are booked as tank truck diesel too.`);
    }
    return { summary: s, card, txns, status, errors, warnings };
}

async function saveCardFromPdf(locationCode, buffer, fileName, by) {
    const r = await buildCardFromPdf(locationCode, buffer);
    if (r.errors.length) {
        const e = new Error(r.errors.join(' '));
        e.userFacing = true;
        throw e;
    }
    if (r.status === 'EXISTS') throw Object.assign(new Error('This statement (card and month) is already uploaded.'), { userFacing: true });
    if (r.status === 'BEFORE_START') throw Object.assign(new Error('This statement is for a month before the card\'s start date.'), { userFacing: true });
    const s = r.summary, L = s.loyalty || {};
    const id = await TtDao.createCardStatement(locationCode, {
        card_id: r.card.card_id, period_from: s.period_from, period_to: s.period_to,
        ccms_opening: s.ccms.opening, ccms_recharge: s.ccms.recharge, ccms_sale: r2(s.ccms.sale + s.ccms.sale_complete), ccms_closing: s.ccms.closing,
        pts_opening: L.opening || 0, pts_award: L.award || 0, pts_redemption: L.redemption || 0, pts_withheld: L.withheld || 0,
        pts_tds: L.tds || 0, pts_expiry: L.expiry || 0, pts_closing: L.closing || 0,
        file_name: fileName ? String(fileName).substring(0, 200) : null
    }, r.txns.map(t => ({
        sno: t.sno, kind: t.kind, txn_type: t.txn_type ? t.txn_type.substring(0, 50) : null, txn_ref: t.txn_ref ? t.txn_ref.substring(0, 30) : null,
        txn_date: t.txn_date, txn_time: t.txn_time && t.txn_time.length > 10 ? t.txn_time : null, settle_date: t.settle_date,
        merchant: t.merchant ? t.merchant.substring(0, 100) : null, merchant_pan: t.merchant_pan ? t.merchant_pan.substring(0, 15) : null,
        location: t.location ? t.location.substring(0, 100) : null, card_no: t.card_no ? t.card_no.substring(0, 25) : null,
        vehicle_no: t.vehicle_no ? t.vehicle_no.substring(0, 20) : null, product: t.product ? t.product.substring(0, 100) : null,
        currency: t.currency ? t.currency.substring(0, 20) : null, amount: t.amount, balance: t.balance, rupees: t.rupees,
        status: t.status ? t.status.substring(0, 10) : null
    })), by);
    return { statement_id: id, period_from: s.period_from };
}

// ── Reconciliation (the freight worksheet) ──────────────────────────────────
// One row per bill month: what the bills of that month left due (taxable - TDS) against what
// came in the following month, to the bank (tagged "TT FREIGHT - <oil co>") and onto the card
// (XTRAPOWER recharges). IOCL pays a month's two half-month bills together about the 5th of the
// next month, so receipts of month M+1 are set against the bills of month M.
async function buildReconciliation(locationCode, vendorId, fromDate, toDate) {
    const monthKey = (d) => String(d instanceof Date ? d.toISOString() : d).substring(0, 7);
    const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
    const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
    const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

    const recFrom = `${nextMonth(fromDate.substring(0, 7))}-01`;
    const recTo = lastDay(nextMonth(toDate.substring(0, 7)));
    const [bills, bank, card] = await Promise.all([
        TtDao.getInvoices(locationCode, fromDate, toDate),
        TtDao.getBankReceipts(locationCode, vendorId, recFrom, recTo),
        TtDao.getCardRecharges(locationCode, vendorId, recFrom, recTo),
    ]);
    const rows = new Map();
    const row = (ym) => {
        if (!rows.has(ym)) rows.set(ym, { month: ym, bills: [], taxable: 0, tds: 0, due: 0, bank: [], card: [], bankTotal: 0, cardTotal: 0 });
        return rows.get(ym);
    };
    bills.filter(b => b.vendor_id === vendorId).forEach(b => {
        const r = row(monthKey(b.bill_date_iso));
        r.bills.push(b.bill_no);
        r.taxable += Number(b.taxable_value);
        r.tds += Number(b.tds_amount); r.due += Number(b.net_receivable);
    });
    bank.forEach(x => { const r = row(prevMonth(monthKey(x.txn_date))); r.bank.push(x); r.bankTotal += Number(x.amount); });
    card.forEach(x => { const r = row(prevMonth(monthKey(x.txn_date))); r.card.push(x); r.cardTotal += Number(x.amount); });

    const list = Array.from(rows.values())
        .filter(r => r.month >= fromDate.substring(0, 7) && r.month <= toDate.substring(0, 7))
        .sort((a, b) => a.month.localeCompare(b.month))
        .map(r => {
            const received = r2(r.bankTotal + r.cardTotal);
            return Object.assign(r, {
                taxable: r2(r.taxable), tds: r2(r.tds), due: r2(r.due), bankTotal: r2(r.bankTotal), cardTotal: r2(r.cardTotal),
                received, difference: r2(r.due - received),
                cardShare: received > 0 ? Math.round(r.cardTotal / received * 1000) / 10 : null,
                paidIn: nextMonth(r.month)
            });
        });
    const totals = list.reduce((t, r) => {
        ['taxable', 'tds', 'due', 'bankTotal', 'cardTotal', 'received', 'difference'].forEach(k => { t[k] = r2(t[k] + r[k]); });
        return t;
    }, { taxable: 0, tds: 0, due: 0, bankTotal: 0, cardTotal: 0, received: 0, difference: 0 });
    return { rows: list, totals };
}

module.exports = { buildFromPdf, saveFromPdf, computeAmounts, buildCardFromPdf, saveCardFromPdf, buildReconciliation };
