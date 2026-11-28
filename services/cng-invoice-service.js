// services/cng-invoice-service.js — CNG purchase invoices (tkt #481).
//
// A CNG invoice is an ordinary Purchase Invoice (t_tank_invoice, fuel_category 'CNG', line in KG) with no
// tank receipt or decant: the oil company fills the CNG cascade itself. This file holds what the bulk upload
// and the IOCL mail import share: read one PDF, check it is this bunk's CNG invoice, save it unless its
// number is already in. An existing invoice is never overwritten (TankInvoiceDao.saveInvoice would).
const db = require('../db/db-connection');
const TankInvoiceDao = require('../dao/tank-invoice-dao');

// The bunk's CNG product (a tank product named CNG), or null when the bunk does not sell CNG.
async function findCngProduct(locationCode) {
    const rows = await db.sequelize.query(
        `SELECT product_id, product_name FROM m_product
         WHERE location_code = :locationCode AND is_tank_product = 1 AND UPPER(TRIM(product_name)) = 'CNG'
         ORDER BY product_id LIMIT 1`,
        { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }
    );
    return rows[0] || null;
}

// One PDF -> { status: IMPORTED | EXISTS | ERROR, invoice_number, invoice_date, quantity, amount, invoice_id, detail }.
// ERROR carries a reason a person can act on; a DB failure is thrown.
async function importCngPdf(locationCode, buffer, fileName) {
    // required here, not at the top: tank-receipt-controller requires this file
    const { parseInvoiceForLocation, tempInvoiceStore } = require('../controllers/tank-receipt-controller');

    let parsed;
    try {
        parsed = await parseInvoiceForLocation(locationCode, buffer, fileName);
    } catch (e) {
        return { status: 'ERROR', detail: e.message };
    }
    const body = parsed.body || {};
    if (body.tempId) tempInvoiceStore.delete(body.tempId);
    if (!body.success) return { status: 'ERROR', detail: body.error || 'Could not read the PDF.' };
    if (!body.is_cng) return { status: 'ERROR', detail: 'Not a CNG invoice. Upload MS/HSD invoices through New Purchase > Fuel Invoice.' };

    const h = body.data.header || {};
    const lines = body.data.lines || [];
    const out = {
        invoice_number: h.invoice_number || null,
        invoice_date: h.invoice_date || null,
        quantity: lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0),
        amount: h.total_invoice_amount != null ? Number(h.total_invoice_amount) : null,
    };
    if (!out.invoice_number || !out.invoice_date || !lines.length) {
        return { ...out, status: 'ERROR', detail: 'Invoice number, date or line missing in the PDF.' };
    }

    const existing = await TankInvoiceDao.findByInvoiceNumber(locationCode, out.invoice_number);
    if (existing) return { ...out, status: 'EXISTS', invoice_id: existing.id, detail: 'Already entered.' };
    const cancelled = await findCancelled(locationCode, out.invoice_number);
    if (cancelled) {
        return { ...out, status: 'CANCELLED', detail: 'Cancelled by IOCL'
            + (cancelled.cancel_doc_no ? ' (credit ' + cancelled.cancel_doc_no + ')' : '') + ', so not saved again.' };
    }

    const saveLines = lines.map(l => ({
        product_id: Number(body.mappings[l.product_name]),
        product_name: l.product_name,
        quantity: l.quantity,
        qty_unit: 'KG',
        rate_per_kl: l.rate_per_kl || null,
        density: null,
        hsn_code: l.hsn_code || null,
        total_line_amount: l.total_line_amount || null,
        charges: l.charges || []
    }));
    if (saveLines.some(l => !l.product_id)) return { ...out, status: 'ERROR', detail: 'No product to map the CNG line to.' };

    const header = {
        location_id: locationCode,
        supplier_id: Number(body.supplierId),
        supplier: body.supplier,
        invoice_number: out.invoice_number,
        invoice_date: out.invoice_date,
        truck_number: null,
        delivery_doc_no: h.delivery_doc_no || null,
        seal_lock_no: null,
        bay_number: null,
        total_invoice_amount: out.amount,
        fuel_category: 'CNG'
    };
    const inv = await TankInvoiceDao.saveInvoice(header, saveLines, buffer, locationCode, header.supplier_id, fileName);
    return { ...out, status: 'IMPORTED', invoice_id: inv.id, detail: 'Saved.' };
}

// ─── Cancellations ────────────────────────────────────────────────────────────
// IOCL cancels a CNG invoice only by a "CANCELLATION OF INVOICE" credit on the SAP statement, which does not
// name the invoice. Staff pair the credit with the CNG invoice of the same amount; the invoice then moves out
// of t_tank_invoice into t_cng_invoice_cancel (see db/migrations/cng-invoice-cancel.sql).
const { QueryTypes } = db.Sequelize;
const OilInvoiceDao = require('../dao/oil-invoice-dao');
const DocumentStoreDao = require('../dao/document-store-dao');

const CANCEL_DOC_TYPE = 'CNG_INVOICE_CANCEL';
// a cancellation credit is looked for against invoices up to this many days older (on MME's SAP statement,
// Apr-Nov 2026, every credit has its same-amount debits within 5 days)
const MATCH_DAYS = 7;
const AMOUNT_TOL = 1.0;     // rupees

const select = (sql, replacements, transaction) =>
    db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

function findCancelled(locationCode, invoiceNumber) {
    return select(`SELECT cancel_id, cancel_doc_no, cancel_date FROM t_cng_invoice_cancel
                   WHERE location_code = :locationCode AND invoice_number = :invoiceNumber`,
        { locationCode, invoiceNumber }).then(r => r[0] || null);
}

const docNo = remarks => ((String(remarks || '').match(/^\s*(\d{6,})/) || [])[1]) || null;
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// The cancellation credits in a period, each with its paired invoice (when cancelled) or the CNG invoices of the
// same amount it may cancel. Only a credit with exactly one such invoice gets a suggestion. MME buys the same
// amount most days, so several often match; then nothing is preselected (choose = true) and staff pick the
// invoice from the SAP portal, which shows it.
async function getCancellationView(locationCode, fromDate, toDate) {
    const acct = await OilInvoiceDao.getIoclAccount(locationCode);
    const cancelled = await select(`
        SELECT cancel_id, invoice_number, DATE_FORMAT(invoice_date, '%Y-%m-%d') invoice_date, quantity, invoice_amount,
               bank_txn_id, cancel_doc_no, DATE_FORMAT(cancel_date, '%Y-%m-%d') cancel_date, credit_amount,
               cancelled_by, creation_date,
               (SELECT d.doc_id FROM t_document_store d WHERE d.entity_type = :docType AND d.entity_id = c.cancel_id
                  AND d.status = 'ACTIVE' ORDER BY d.doc_id DESC LIMIT 1) doc_id
        FROM t_cng_invoice_cancel c
        WHERE c.location_code = :locationCode
        ORDER BY c.cancel_date, c.cancel_id`, { locationCode, docType: CANCEL_DOC_TYPE });
    if (!acct) return { account: null, credits: [], cancelled, matchDays: MATCH_DAYS };

    const credits = await select(`
        SELECT t_bank_id, DATE_FORMAT(trans_date, '%Y-%m-%d') trans_date, credit_amount, remarks
        FROM t_bank_transaction
        WHERE bank_id = :bankId AND credit_amount > 0 AND remarks LIKE '%CANCELLATION OF INVOICE%'
          AND trans_date BETWEEN :fromDate AND :toDate
        ORDER BY trans_date, t_bank_id`, { bankId: acct.bank_id, fromDate, toDate });
    const invoices = await select(`
        SELECT ti.id, ti.invoice_number, DATE_FORMAT(ti.invoice_date, '%Y-%m-%d') invoice_date, ti.total_invoice_amount amount,
               (SELECT SUM(d.quantity) FROM t_tank_invoice_dtl d WHERE d.invoice_id = ti.id) quantity
        FROM t_tank_invoice ti
        WHERE ti.location_id = :locationCode AND ti.fuel_category = 'CNG'
          AND ti.invoice_date BETWEEN :from AND :toDate
        ORDER BY ti.invoice_date DESC, ti.invoice_number`,
        { locationCode, from: addDays(fromDate, -MATCH_DAYS), toDate });

    const byTxn = new Map(cancelled.filter(c => c.bank_txn_id).map(c => [Number(c.bank_txn_id), c]));
    const rows = credits.map(c => {
        const amt = Number(c.credit_amount);
        const row = { bank_txn_id: c.t_bank_id, trans_date: c.trans_date, credit_amount: amt, cancel_doc_no: docNo(c.remarks),
                      cancelled: byTxn.get(Number(c.t_bank_id)) || null, candidates: [], suggested_id: null, choose: false };
        if (!row.cancelled) {
            row.candidates = invoices.filter(i => Math.abs(Number(i.amount) - amt) <= AMOUNT_TOL
                && i.invoice_date <= c.trans_date && i.invoice_date >= addDays(c.trans_date, -MATCH_DAYS));
        }
        return row;
    });

    // Suggest: credits with a single free candidate take it first, which may leave single candidates for others.
    const taken = new Set();
    const free = r => r.candidates.filter(i => !taken.has(i.id));
    let changed = true;
    while (changed) {
        changed = false;
        for (const r of rows) {
            if (r.cancelled || r.suggested_id) continue;
            const f = free(r);
            if (f.length === 1) { r.suggested_id = f[0].id; taken.add(f[0].id); changed = true; }
        }
    }
    for (const r of rows) {
        if (!r.cancelled && !r.suggested_id && r.candidates.length) r.choose = true;
    }
    return { account: acct, credits: rows, cancelled, matchDays: MATCH_DAYS };
}

// Move one CNG invoice out of the purchase books against one SAP cancellation credit.
async function cancelInvoice(locationCode, invoiceId, bankTxnId, user) {
    const acct = await OilInvoiceDao.getIoclAccount(locationCode);
    if (!acct) throw userError(`${locationCode} has no IOCL SAP account.`);
    const [credit] = await select(`
        SELECT t_bank_id, DATE_FORMAT(trans_date, '%Y-%m-%d') trans_date, credit_amount, remarks FROM t_bank_transaction
        WHERE t_bank_id = :bankTxnId AND bank_id = :bankId AND credit_amount > 0 AND remarks LIKE '%CANCELLATION OF INVOICE%'`,
        { bankTxnId, bankId: acct.bank_id });
    if (!credit) throw userError('That cancellation credit is not on this bunk\'s IOCL SAP statement.');

    return db.sequelize.transaction(async (t) => {
        const [inv] = await select(`SELECT ti.*, DATE_FORMAT(ti.invoice_date, '%Y-%m-%d') invoice_date_iso FROM t_tank_invoice ti
                                    WHERE ti.id = :invoiceId AND ti.location_id = :locationCode
                                    AND ti.fuel_category = 'CNG' FOR UPDATE`, { invoiceId, locationCode }, t);
        if (!inv) throw userError('That CNG invoice is no longer in Purchase Invoices.');
        if (Math.abs(Number(inv.total_invoice_amount) - Number(credit.credit_amount)) > AMOUNT_TOL) {
            throw userError(`Invoice ${inv.invoice_number} is Rs ${inv.total_invoice_amount}, the credit is Rs ${credit.credit_amount}.`);
        }
        const [used] = await select(`SELECT invoice_number FROM t_cng_invoice_cancel WHERE bank_txn_id = :bankTxnId`, { bankTxnId }, t);
        if (used) throw userError(`That credit already cancels invoice ${used.invoice_number}.`);

        const lines = await select(`SELECT * FROM t_tank_invoice_dtl WHERE invoice_id = :invoiceId ORDER BY id`, { invoiceId }, t);
        for (const l of lines) {
            l.charges = await select(`SELECT charge_type, charge_pct, charge_amount FROM t_tank_invoice_charges
                                      WHERE invoice_dtl_id = :id ORDER BY id`, { id: l.id }, t);
        }
        const header = { ...inv, invoice_date: inv.invoice_date_iso };   // no Date objects: they shift a day through JSON
        delete header.invoice_pdf;
        delete header.invoice_date_iso;
        inv.invoice_date = inv.invoice_date_iso;
        const qty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

        const [cancelId] = await db.sequelize.query(`
            INSERT INTO t_cng_invoice_cancel (location_code, invoice_number, invoice_date, quantity, invoice_amount,
                bank_txn_id, cancel_doc_no, cancel_date, credit_amount, invoice_data, cancelled_by)
            VALUES (:locationCode, :invoice_number, :invoice_date, :qty, :amount, :bankTxnId, :cancelDocNo, :cancelDate,
                :creditAmount, :data, :user)`,
            { replacements: { locationCode, invoice_number: inv.invoice_number, invoice_date: inv.invoice_date, qty,
                amount: inv.total_invoice_amount, bankTxnId, cancelDocNo: docNo(credit.remarks), cancelDate: credit.trans_date,
                creditAmount: credit.credit_amount, data: JSON.stringify({ header, lines }), user },
              type: QueryTypes.INSERT, transaction: t });

        // GL: drop a pending event; reverse vouchers already posted (same as a deleted TT invoice)
        await db.sequelize.query(`DELETE FROM gl_accounting_events
            WHERE source_type = 'TANK_INVOICE' AND source_id = :invoiceId AND event_status <> 'PROCESSED'`,
            { replacements: { invoiceId }, type: QueryTypes.DELETE, transaction: t });
        const [last] = await select(`SELECT location_code, fy_id, event_type, event_date FROM gl_accounting_events
            WHERE source_type = 'TANK_INVOICE' AND source_id = :invoiceId ORDER BY event_id DESC LIMIT 1`, { invoiceId }, t);
        if (last && last.event_type !== 'DELETE') {
            await db.sequelize.query(`INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                VALUES (:location_code, :fy_id, 'TANK_INVOICE', :invoiceId, 'DELETE', :event_date, 'UNPROCESSED', :user)`,
                { replacements: { ...last, invoiceId, user }, type: QueryTypes.INSERT, transaction: t });
        }

        // the PDF stays, now hung on the cancel row
        await db.sequelize.query(`UPDATE t_document_store SET entity_type = :docType, entity_id = :cancelId
            WHERE entity_type = 'TANK_INVOICE' AND entity_id = :invoiceId`,
            { replacements: { docType: CANCEL_DOC_TYPE, cancelId, invoiceId }, type: QueryTypes.UPDATE, transaction: t });
        await db.sequelize.query(`DELETE c FROM t_tank_invoice_charges c JOIN t_tank_invoice_dtl d ON d.id = c.invoice_dtl_id
            WHERE d.invoice_id = :invoiceId`, { replacements: { invoiceId }, type: QueryTypes.DELETE, transaction: t });
        await db.sequelize.query(`DELETE FROM t_tank_invoice_dtl WHERE invoice_id = :invoiceId`,
            { replacements: { invoiceId }, type: QueryTypes.DELETE, transaction: t });
        await db.sequelize.query(`DELETE FROM t_tank_invoice WHERE id = :invoiceId`,
            { replacements: { invoiceId }, type: QueryTypes.DELETE, transaction: t });
        return { cancel_id: cancelId, invoice_number: inv.invoice_number };
    });
}

// Put a cancelled invoice back into Purchase Invoices (wrong pairing). It gets a new id; Create Accounting
// picks it up as a new invoice.
async function restoreInvoice(locationCode, cancelId) {
    const [c] = await select(`SELECT * FROM t_cng_invoice_cancel WHERE cancel_id = :cancelId AND location_code = :locationCode`,
        { cancelId, locationCode });
    if (!c) throw userError('That cancelled invoice is not on record.');
    if (await TankInvoiceDao.findByInvoiceNumber(locationCode, c.invoice_number)) {
        throw userError(`Invoice ${c.invoice_number} is already in Purchase Invoices.`);
    }
    const data = typeof c.invoice_data === 'string' ? JSON.parse(c.invoice_data) : c.invoice_data;
    const h = data.header;
    const header = {
        location_id: locationCode, supplier_id: h.supplier_id, supplier: h.supplier, invoice_number: h.invoice_number,
        invoice_date: h.invoice_date || null, invoice_time: h.invoice_time || null,
        truck_number: h.truck_number, delivery_doc_no: h.delivery_doc_no, seal_lock_no: h.seal_lock_no,
        bay_number: h.bay_number, fuel_category: 'CNG', total_invoice_amount: h.total_invoice_amount
    };
    const lines = (data.lines || []).map(l => ({
        product_id: l.product_id, product_name: l.product_name, quantity: l.quantity, qty_unit: l.qty_unit || 'KG',
        rate_per_kl: l.rate_per_kl, density: l.density, hsn_code: l.hsn_code, total_line_amount: l.total_line_amount,
        charges: (l.charges || []).map(ch => ({ charge_type: ch.charge_type, charge_pct: ch.charge_pct, charge_amount: ch.charge_amount }))
    }));
    const inv = await TankInvoiceDao.saveInvoice(header, lines, null, null, null, null);
    await db.sequelize.transaction(async (t) => {
        await db.sequelize.query(`UPDATE t_document_store SET entity_type = 'TANK_INVOICE', entity_id = :invoiceId
            WHERE entity_type = :docType AND entity_id = :cancelId`,
            { replacements: { invoiceId: inv.id, docType: CANCEL_DOC_TYPE, cancelId }, type: QueryTypes.UPDATE, transaction: t });
        await db.sequelize.query(`DELETE FROM t_cng_invoice_cancel WHERE cancel_id = :cancelId`,
            { replacements: { cancelId }, type: QueryTypes.DELETE, transaction: t });
    });
    return { invoice_id: inv.id, invoice_number: c.invoice_number };
}

async function getCancelledPdf(locationCode, cancelId) {
    const [c] = await select(`SELECT cancel_id FROM t_cng_invoice_cancel WHERE cancel_id = :cancelId AND location_code = :locationCode`,
        { cancelId, locationCode });
    if (!c) return null;
    const docs = await DocumentStoreDao.findByEntity(CANCEL_DOC_TYPE, cancelId);
    return docs.length ? DocumentStoreDao.findById(docs[0].doc_id) : null;
}

function userError(msg) { const e = new Error(msg); e.userFacing = true; return e; }

module.exports = { findCngProduct, importCngPdf, findCancelled, getCancellationView, cancelInvoice, restoreInvoice, getCancelledPdf };
