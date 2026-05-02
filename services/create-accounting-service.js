// services/create-accounting-service.js
// GL accounting engine — processes gl_accounting_events → gl_journal_headers + gl_journal_lines
//
// Event types handled:
//   CREDIT_SALE         (source_id = tcredit_id)       — Customer DR / Sales CR + Output CGST/SGST CR
//   CASH_SALE           (source_id = cashsales_id)     — Cash DR / Sales CR + Output CGST/SGST CR
//   DAY_BILL            (source_id = day_bill_id)      — Cash/Digital DR / Sales CR + GST CRs per line
//   BANK_TXN            (source_id = t_bank_id)        — bank statement / oil-company SOA line
//   BOWSER_CREDIT_SALE  (source_id = credit_id)        — Customer DR / Sales CR (no GST, HSD 0%)
//   BOWSER_CASH_SALE    (source_id = cashsale_id)      — Cash DR / Sales CR
//   BOWSER_DIGITAL_SALE (source_id = digital_id)       — Vendor DR / Sales CR
//   LUBES_INVOICE       (source_id = lubes_hdr_id)     — Purchase DR + Input CGST/SGST DR / Supplier CR
//   TANK_INVOICE        (source_id = t_tank_invoice.id)— Purchase DR + Charges DR / Supplier CR
//
// Raised automatically by DB triggers on source tables.
// UPDATE events reverse existing vouchers and regenerate fresh ones.
// DELETE events reverse only.

const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

const VOUCHER_PREFIXES = {
    SALES:    'SAL',
    PURCHASE: 'PUR',
    PAYMENT:  'PMT',
    RECEIPT:  'RCT',
    JOURNAL:  'JNL',
    CONTRA:   'CNT'
};

// Source types that belong to a shift — blocked if t_closing is still DRAFT.
// BANK_TXN / PURCHASE_INVOICE / MANUAL_JOURNAL are not shift-bound and always process.
const SHIFT_BOUND_TYPES  = new Set(['CREDIT_SALE', 'CASH_SALE', 'DAY_BILL']);

// Source types that belong to a bowser closing — blocked if t_bowser_closing is still DRAFT.
const BOWSER_BOUND_TYPES = new Set(['BOWSER_CREDIT_SALE', 'BOWSER_CASH_SALE', 'BOWSER_DIGITAL_SALE']);

// ─── Public API ───────────────────────────────────────────────────────────────

async function processEvents(locationCode, fromDate, toDate, processedBy) {
    const [events, openShiftDates, openBowserDates] = await Promise.all([
        db.sequelize.query(`
            SELECT * FROM gl_accounting_events
            WHERE location_code = :locationCode
              AND event_date BETWEEN :fromDate AND :toDate
              AND event_status = 'UNPROCESSED'
            ORDER BY event_date, event_id
        `, { replacements: { locationCode, fromDate, toDate }, type: QueryTypes.SELECT }),
        getOpenShiftDates(locationCode, fromDate, toDate),
        getOpenBowserDates(locationCode, fromDate, toDate)
    ]);

    const summary = { processed: 0, errors: 0, skipped: 0, blocked: 0, blockedDates: [], details: [] };

    for (const event of events) {
        const eventDate = typeof event.event_date === 'string'
            ? event.event_date.substring(0, 10)
            : event.event_date.toISOString().substring(0, 10);

        if (SHIFT_BOUND_TYPES.has(event.source_type) && openShiftDates.has(eventDate)) {
            summary.blocked++;
            if (!summary.blockedDates.includes(eventDate)) summary.blockedDates.push(eventDate);
            summary.details.push({ event_id: event.event_id, status: 'BLOCKED', reason: `Shift on ${eventDate} is still DRAFT` });
            continue;
        }

        if (BOWSER_BOUND_TYPES.has(event.source_type) && openBowserDates.has(eventDate)) {
            summary.blocked++;
            if (!summary.blockedDates.includes(eventDate)) summary.blockedDates.push(eventDate);
            summary.details.push({ event_id: event.event_id, status: 'BLOCKED', reason: `Bowser closing on ${eventDate} is still DRAFT` });
            continue;
        }

        try {
            const result = await processEvent(event, processedBy);
            summary.processed += result.voucherCount;
            summary.details.push({ event_id: event.event_id, status: 'PROCESSED', vouchers: result.voucherCount });
        } catch (err) {
            await markEventError(event.event_id, err.message);
            summary.errors++;
            summary.details.push({ event_id: event.event_id, status: 'ERROR', message: err.message });
        }
    }

    return summary;
}

async function reprocessEvents(locationCode, fromDate, toDate, processedBy) {
    await db.sequelize.query(`
        UPDATE gl_accounting_events
        SET event_status  = 'UNPROCESSED',
            event_type    = 'UPDATE',
            voucher_id    = NULL,
            error_message = NULL,
            processed_at  = NULL,
            processed_by  = NULL
        WHERE location_code = :locationCode
          AND event_date BETWEEN :fromDate AND :toDate
          AND event_status IN ('PROCESSED', 'ERROR')
    `, {
        replacements: { locationCode, fromDate, toDate },
        type: QueryTypes.UPDATE
    });

    return await processEvents(locationCode, fromDate, toDate, processedBy);
}

module.exports = { processEvents, reprocessEvents, generateMissingEvents };

// ─── Generate Missing Events ──────────────────────────────────────────────────
// Backfill tool: scan each source table for records with no event and INSERT them.
// Safe to run multiple times — NOT EXISTS guard prevents duplicates.

async function generateMissingEvents(locationCode, fromDate, toDate, createdBy) {
    const counts = {};
    let total = 0;

    const run = async (sourceType, sql) => {
        const [, meta] = await db.sequelize.query(sql, {
            replacements: { locationCode, fromDate, toDate, createdBy },
            type: QueryTypes.INSERT
        });
        const n = meta?.affectedRows || 0;
        counts[sourceType] = n;
        total += n;
    };

    await run('CREDIT_SALE', `
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        SELECT cl.location_code, fy.fy_id, 'CREDIT_SALE', tc.tcredit_id, 'CREATE',
               DATE(cl.closing_date), 'UNPROCESSED', :createdBy
        FROM t_credits tc
        JOIN t_closing cl ON cl.closing_id = tc.closing_id
        JOIN gl_financial_years fy ON fy.location_code = cl.location_code
            AND DATE(cl.closing_date) BETWEEN fy.start_date AND fy.end_date
        WHERE cl.location_code = :locationCode
          AND DATE(cl.closing_date) BETWEEN :fromDate AND :toDate
          AND NOT EXISTS (
              SELECT 1 FROM gl_accounting_events e
              WHERE e.source_type = 'CREDIT_SALE' AND e.source_id = tc.tcredit_id
          )
    `);

    await run('CASH_SALE', `
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        SELECT cl.location_code, fy.fy_id, 'CASH_SALE', cs.cashsales_id, 'CREATE',
               DATE(cl.closing_date), 'UNPROCESSED', :createdBy
        FROM t_cashsales cs
        JOIN t_closing cl ON cl.closing_id = cs.closing_id
        JOIN gl_financial_years fy ON fy.location_code = cl.location_code
            AND DATE(cl.closing_date) BETWEEN fy.start_date AND fy.end_date
        WHERE cl.location_code = :locationCode
          AND DATE(cl.closing_date) BETWEEN :fromDate AND :toDate
          AND NOT EXISTS (
              SELECT 1 FROM gl_accounting_events e
              WHERE e.source_type = 'CASH_SALE' AND e.source_id = cs.cashsales_id
          )
    `);

    await run('DAY_BILL', `
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        SELECT db.location_code, fy.fy_id, 'DAY_BILL', db.day_bill_id, 'CREATE',
               db.bill_date, 'UNPROCESSED', :createdBy
        FROM t_day_bill db
        JOIN gl_financial_years fy ON fy.location_code = db.location_code
            AND db.bill_date BETWEEN fy.start_date AND fy.end_date
        WHERE db.location_code = :locationCode
          AND db.bill_date BETWEEN :fromDate AND :toDate
          AND NOT EXISTS (
              SELECT 1 FROM gl_accounting_events e
              WHERE e.source_type = 'DAY_BILL' AND e.source_id = db.day_bill_id
          )
    `);

    await run('BANK_TXN', `
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        SELECT mb.location_code, fy.fy_id, 'BANK_TXN', tbt.t_bank_id, 'CREATE',
               DATE(tbt.trans_date), 'UNPROCESSED', :createdBy
        FROM t_bank_transaction tbt
        JOIN m_bank mb ON mb.bank_id = tbt.bank_id
        JOIN gl_financial_years fy ON fy.location_code = mb.location_code
            AND DATE(tbt.trans_date) BETWEEN fy.start_date AND fy.end_date
        WHERE mb.location_code = :locationCode
          AND DATE(tbt.trans_date) BETWEEN :fromDate AND :toDate
          AND NOT EXISTS (
              SELECT 1 FROM gl_accounting_events e
              WHERE e.source_type = 'BANK_TXN' AND e.source_id = tbt.t_bank_id
          )
    `);

    await run('BOWSER_CREDIT_SALE', `
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        SELECT tbc.location_code, fy.fy_id, 'BOWSER_CREDIT_SALE', bc.credit_id, 'CREATE',
               DATE(tbc.closing_date), 'UNPROCESSED', :createdBy
        FROM t_bowser_credits bc
        JOIN t_bowser_closing tbc ON tbc.bowser_closing_id = bc.bowser_closing_id
        JOIN gl_financial_years fy ON fy.location_code = tbc.location_code
            AND DATE(tbc.closing_date) BETWEEN fy.start_date AND fy.end_date
        WHERE tbc.location_code = :locationCode
          AND DATE(tbc.closing_date) BETWEEN :fromDate AND :toDate
          AND NOT EXISTS (
              SELECT 1 FROM gl_accounting_events e
              WHERE e.source_type = 'BOWSER_CREDIT_SALE' AND e.source_id = bc.credit_id
          )
    `);

    await run('BOWSER_CASH_SALE', `
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        SELECT tbc.location_code, fy.fy_id, 'BOWSER_CASH_SALE', bcs.cashsale_id, 'CREATE',
               DATE(tbc.closing_date), 'UNPROCESSED', :createdBy
        FROM t_bowser_cashsales bcs
        JOIN t_bowser_closing tbc ON tbc.bowser_closing_id = bcs.bowser_closing_id
        JOIN gl_financial_years fy ON fy.location_code = tbc.location_code
            AND DATE(tbc.closing_date) BETWEEN fy.start_date AND fy.end_date
        WHERE tbc.location_code = :locationCode
          AND DATE(tbc.closing_date) BETWEEN :fromDate AND :toDate
          AND NOT EXISTS (
              SELECT 1 FROM gl_accounting_events e
              WHERE e.source_type = 'BOWSER_CASH_SALE' AND e.source_id = bcs.cashsale_id
          )
    `);

    await run('BOWSER_DIGITAL_SALE', `
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        SELECT tbc.location_code, fy.fy_id, 'BOWSER_DIGITAL_SALE', bds.digital_id, 'CREATE',
               DATE(tbc.closing_date), 'UNPROCESSED', :createdBy
        FROM t_bowser_digital_sales bds
        JOIN t_bowser_closing tbc ON tbc.bowser_closing_id = bds.bowser_closing_id
        JOIN gl_financial_years fy ON fy.location_code = tbc.location_code
            AND DATE(tbc.closing_date) BETWEEN fy.start_date AND fy.end_date
        WHERE tbc.location_code = :locationCode
          AND DATE(tbc.closing_date) BETWEEN :fromDate AND :toDate
          AND NOT EXISTS (
              SELECT 1 FROM gl_accounting_events e
              WHERE e.source_type = 'BOWSER_DIGITAL_SALE' AND e.source_id = bds.digital_id
          )
    `);

    await run('LUBES_INVOICE', `
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        SELECT lh.location_code, fy.fy_id, 'LUBES_INVOICE', lh.lubes_hdr_id, 'CREATE',
               lh.invoice_date, 'UNPROCESSED', :createdBy
        FROM t_lubes_inv_hdr lh
        JOIN gl_financial_years fy ON fy.location_code = lh.location_code
            AND lh.invoice_date BETWEEN fy.start_date AND fy.end_date
        WHERE lh.location_code = :locationCode
          AND lh.invoice_date BETWEEN :fromDate AND :toDate
          AND NOT EXISTS (
              SELECT 1 FROM gl_accounting_events e
              WHERE e.source_type = 'LUBES_INVOICE' AND e.source_id = lh.lubes_hdr_id
          )
    `);

    await run('TANK_INVOICE', `
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        SELECT ti.location_id, fy.fy_id, 'TANK_INVOICE', ti.id, 'CREATE',
               ti.invoice_date, 'UNPROCESSED', :createdBy
        FROM t_tank_invoice ti
        JOIN gl_financial_years fy ON fy.location_code = ti.location_id
            AND ti.invoice_date BETWEEN fy.start_date AND fy.end_date
        WHERE ti.location_id = :locationCode
          AND ti.invoice_date BETWEEN :fromDate AND :toDate
          AND NOT EXISTS (
              SELECT 1 FROM gl_accounting_events e
              WHERE e.source_type = 'TANK_INVOICE' AND e.source_id = ti.id
          )
    `);

    return { counts, total };
}

// ─── Event Dispatcher ─────────────────────────────────────────────────────────

async function processEvent(event, processedBy) {
    if (event.event_type === 'UPDATE' || event.event_type === 'DELETE') {
        await reverseExistingVouchers(event.location_code, event.source_type, event.source_id, processedBy);
    }

    if (event.event_type === 'DELETE') {
        await markEventProcessed(event.event_id, null, processedBy);
        return { voucherCount: 0 };
    }

    switch (event.source_type) {
        case 'CREDIT_SALE':         return await processCreditSaleEvent(event, processedBy);
        case 'CASH_SALE':           return await processCashSaleEvent(event, processedBy);
        case 'DAY_BILL':            return await processDayBillEvent(event, processedBy);
        case 'BANK_TXN':            return await processBankTxnEvent(event, processedBy);
        case 'BOWSER_CREDIT_SALE':  return await processBowserCreditSaleEvent(event, processedBy);
        case 'BOWSER_CASH_SALE':    return await processBowserCashSaleEvent(event, processedBy);
        case 'BOWSER_DIGITAL_SALE': return await processBowserDigitalSaleEvent(event, processedBy);
        case 'LUBES_INVOICE':       return await processLubesInvoiceEvent(event, processedBy);
        case 'TANK_INVOICE':        return await processTankInvoiceEvent(event, processedBy);
        default:
            throw new Error(`Unhandled source_type: ${event.source_type}`);
    }
}

// ─── CREDIT_SALE Handler ──────────────────────────────────────────────────────
// Customer DR (total) → Sales CR (base) + Output CGST CR + Output SGST CR

async function processCreditSaleEvent(event, processedBy) {
    const { location_code, fy_id, source_id: tcreditId, event_date } = event;

    const rows = await db.sequelize.query(`
        SELECT
            tc.tcredit_id,
            tc.product_id,
            p.product_name,
            tc.creditlist_id,
            cl.Company_Name AS customer_name,
            tc.qty,
            tc.amount,
            tc.base_amount,
            tc.cgst_amount,
            tc.sgst_amount,
            tc.bill_no
        FROM t_credits tc
        JOIN m_product p       ON p.product_id     = tc.product_id
        JOIN m_credit_list cl  ON cl.creditlist_id  = tc.creditlist_id
        WHERE tc.tcredit_id = :tcreditId
    `, {
        replacements: { tcreditId },
        type: QueryTypes.SELECT
    });

    if (!rows.length) throw new Error(`Credit entry not found: tcredit_id=${tcreditId}`);
    const row = rows[0];

    const salesLedgerId = await resolveProductLedger(location_code, row.product_id, 'SALES');
    if (!salesLedgerId) throw new Error(`Sales ledger not configured for product ${row.product_name} (id:${row.product_id})`);

    const customerLedgerId = await resolveLedger(location_code, 'CREDIT', row.creditlist_id);
    if (!customerLedgerId) throw new Error(`GL ledger not found for customer ${row.customer_name} (creditlist_id:${row.creditlist_id})`);

    const totalAmount = parseFloat(row.amount);
    const baseAmount  = parseFloat(row.base_amount  || totalAmount);
    const cgstAmount  = parseFloat(row.cgst_amount  || 0);
    const sgstAmount  = parseFloat(row.sgst_amount  || 0);
    const qty         = parseFloat(row.qty).toFixed(3);
    const narration   = `${qty} ${row.product_name} | ₹${totalAmount.toFixed(2)} | ${row.customer_name} | Bill: ${row.bill_no}`;

    const lines = [
        { ledger_id: customerLedgerId, dr_amount: totalAmount, cr_amount: 0,           narration },
        { ledger_id: salesLedgerId,    dr_amount: 0,           cr_amount: baseAmount,  narration }
    ];

    if (cgstAmount > 0) {
        const cgstLedgerId = await resolveProductLedger(location_code, row.product_id, 'OUTPUT_CGST');
        if (!cgstLedgerId) throw new Error(`OUTPUT_CGST ledger not mapped for product ${row.product_name} at ${location_code}`);
        lines.push({ ledger_id: cgstLedgerId, dr_amount: 0, cr_amount: cgstAmount, narration });
    }
    if (sgstAmount > 0) {
        const sgstLedgerId = await resolveProductLedger(location_code, row.product_id, 'OUTPUT_SGST');
        if (!sgstLedgerId) throw new Error(`OUTPUT_SGST ledger not mapped for product ${row.product_name} at ${location_code}`);
        lines.push({ ledger_id: sgstLedgerId, dr_amount: 0, cr_amount: sgstAmount, narration });
    }

    const vid = await createVoucher({
        locationCode: location_code,
        fyId:         fy_id,
        voucherType:  'SALES',
        voucherDate:  event_date,
        sourceType:   'CREDIT_SALE',
        sourceId:     tcreditId,
        narration,
        lines,
        postedBy: processedBy
    });

    await markEventProcessed(event.event_id, vid, processedBy);
    return { voucherCount: 1 };
}

// ─── CASH_SALE Handler ────────────────────────────────────────────────────────
// Cash DR (total) → Sales CR (base) + Output CGST CR + Output SGST CR

async function processCashSaleEvent(event, processedBy) {
    const { location_code, fy_id, source_id: cashsalesId, event_date } = event;

    const rows = await db.sequelize.query(`
        SELECT
            cs.cashsales_id,
            cs.product_id,
            p.product_name,
            cs.qty,
            cs.amount,
            cs.base_amount,
            cs.cgst_amount,
            cs.sgst_amount,
            cs.bill_no
        FROM t_cashsales cs
        JOIN m_product p ON p.product_id = cs.product_id
        WHERE cs.cashsales_id = :cashsalesId
    `, {
        replacements: { cashsalesId },
        type: QueryTypes.SELECT
    });

    if (!rows.length) throw new Error(`Cash sale not found: cashsales_id=${cashsalesId}`);
    const row = rows[0];

    if (parseFloat(row.amount) <= 0) {
        await markEventProcessed(event.event_id, null, processedBy);
        return { voucherCount: 0 };
    }

    const salesLedgerId = await resolveProductLedger(location_code, row.product_id, 'SALES');
    if (!salesLedgerId) throw new Error(`Sales ledger not configured for product ${row.product_name} (id:${row.product_id})`);

    const cashLedgerId = await resolveCashLedger(location_code);
    if (!cashLedgerId) throw new Error(`Cash-in-Hand ledger not found for location ${location_code}`);

    const totalAmount = parseFloat(row.amount);
    const baseAmount  = parseFloat(row.base_amount  || totalAmount);
    const cgstAmount  = parseFloat(row.cgst_amount  || 0);
    const sgstAmount  = parseFloat(row.sgst_amount  || 0);
    const qty         = parseFloat(row.qty).toFixed(3);
    const narration   = `${qty} ${row.product_name} | ₹${totalAmount.toFixed(2)} | Bill: ${row.bill_no}`;

    const lines = [
        { ledger_id: cashLedgerId,  dr_amount: totalAmount, cr_amount: 0,          narration },
        { ledger_id: salesLedgerId, dr_amount: 0,           cr_amount: baseAmount, narration }
    ];

    if (cgstAmount > 0) {
        const cgstLedgerId = await resolveProductLedger(location_code, row.product_id, 'OUTPUT_CGST');
        if (!cgstLedgerId) throw new Error(`OUTPUT_CGST ledger not mapped for product ${row.product_name} at ${location_code}`);
        lines.push({ ledger_id: cgstLedgerId, dr_amount: 0, cr_amount: cgstAmount, narration });
    }
    if (sgstAmount > 0) {
        const sgstLedgerId = await resolveProductLedger(location_code, row.product_id, 'OUTPUT_SGST');
        if (!sgstLedgerId) throw new Error(`OUTPUT_SGST ledger not mapped for product ${row.product_name} at ${location_code}`);
        lines.push({ ledger_id: sgstLedgerId, dr_amount: 0, cr_amount: sgstAmount, narration });
    }

    const vid = await createVoucher({
        locationCode: location_code,
        fyId:         fy_id,
        voucherType:  'SALES',
        voucherDate:  event_date,
        sourceType:   'CASH_SALE',
        sourceId:     cashsalesId,
        narration,
        lines,
        postedBy: processedBy
    });

    await markEventProcessed(event.event_id, vid, processedBy);
    return { voucherCount: 1 };
}

// ─── DAY_BILL Handler ─────────────────────────────────────────────────────────
// One voucher per day bill header:
//   CASH header   → Cash DR          → Product Sales CR (per product line)
//   DIGITAL header → Vendor (creditlist card_flag=Y) DR → Product Sales CR (per product line)

async function processDayBillEvent(event, processedBy) {
    const { location_code, fy_id, source_id: dayBillId, event_date } = event;
    const voucherIds = [];

    // Fetch all headers for this day bill
    const headers = await db.sequelize.query(`
        SELECT
            dbh.header_id,
            dbh.bill_type,
            dbh.vendor_id,
            dbh.total_amount,
            CASE WHEN dbh.bill_type = 'DIGITAL' THEN cl.Company_Name ELSE 'CASH' END AS party_name
        FROM t_day_bill_header dbh
        LEFT JOIN m_credit_list cl ON cl.creditlist_id = dbh.vendor_id
        WHERE dbh.day_bill_id = :dayBillId
        ORDER BY dbh.bill_type, dbh.header_id
    `, {
        replacements: { dayBillId },
        type: QueryTypes.SELECT
    });

    if (!headers.length) {
        // Day bill exists but has no headers yet (regeneration in progress) — skip silently
        await markEventProcessed(event.event_id, null, processedBy);
        return { voucherCount: 0 };
    }

    const cashLedgerId = await resolveCashLedger(location_code);
    if (!cashLedgerId) throw new Error(`Cash-in-Hand ledger not found for location ${location_code}`);

    for (const header of headers) {
        if (parseFloat(header.total_amount) <= 0) continue;

        // Resolve the debit ledger
        let drLedgerId;
        if (header.bill_type === 'CASH') {
            drLedgerId = cashLedgerId;
        } else {
            // Digital vendor — creditlist with card_flag=Y
            drLedgerId = await resolveLedger(location_code, 'CREDIT', header.vendor_id);
            if (!drLedgerId) throw new Error(`GL ledger not found for digital vendor ${header.party_name} (creditlist_id:${header.vendor_id})`);
        }

        // Fetch line items for this header
        const items = await db.sequelize.query(`
            SELECT
                dbi.product_id,
                p.product_name,
                dbi.quantity,
                dbi.total_amount,
                dbi.base_amount,
                dbi.cgst_amount,
                dbi.sgst_amount
            FROM t_day_bill_items dbi
            JOIN m_product p ON p.product_id = dbi.product_id
            WHERE dbi.header_id = :headerId
              AND dbi.total_amount > 0
        `, {
            replacements: { headerId: header.header_id },
            type: QueryTypes.SELECT
        });

        if (!items.length) continue;

        // Build journal lines — one DR line (payment method) + Sales/GST CR lines per product
        const lines = [];
        const totalAmount = parseFloat(header.total_amount);
        const headerNarration = `Day Bill ${header.bill_type}${header.bill_type === 'DIGITAL' ? ' — ' + header.party_name : ''} | ₹${totalAmount.toFixed(2)} | ${event_date}`;

        // Debit: payment method (Cash or Digital vendor) for total
        lines.push({ ledger_id: drLedgerId, dr_amount: totalAmount, cr_amount: 0, narration: headerNarration });

        // Credit: Sales (base) + Output CGST + Output SGST per product
        for (const item of items) {
            const salesLedgerId = await resolveProductLedger(location_code, item.product_id, 'SALES');
            if (!salesLedgerId) throw new Error(`Sales ledger not configured for product ${item.product_name} (id:${item.product_id})`);

            const itemTotal   = parseFloat(item.total_amount);
            const itemBase    = parseFloat(item.base_amount  || itemTotal);
            const itemCgst    = parseFloat(item.cgst_amount  || 0);
            const itemSgst    = parseFloat(item.sgst_amount  || 0);
            const itemNarration = `${parseFloat(item.quantity).toFixed(3)} ${item.product_name} | ₹${itemTotal.toFixed(2)} | ${headerNarration}`;

            lines.push({ ledger_id: salesLedgerId, dr_amount: 0, cr_amount: itemBase, narration: itemNarration });

            if (itemCgst > 0) {
                const cgstLedgerId = await resolveProductLedger(location_code, item.product_id, 'OUTPUT_CGST');
                if (!cgstLedgerId) throw new Error(`OUTPUT_CGST ledger not mapped for product ${item.product_name} at ${location_code}`);
                lines.push({ ledger_id: cgstLedgerId, dr_amount: 0, cr_amount: itemCgst, narration: itemNarration });
            }
            if (itemSgst > 0) {
                const sgstLedgerId = await resolveProductLedger(location_code, item.product_id, 'OUTPUT_SGST');
                if (!sgstLedgerId) throw new Error(`OUTPUT_SGST ledger not mapped for product ${item.product_name} at ${location_code}`);
                lines.push({ ledger_id: sgstLedgerId, dr_amount: 0, cr_amount: itemSgst, narration: itemNarration });
            }
        }

        const vid = await createVoucher({
            locationCode: location_code,
            fyId:         fy_id,
            voucherType:  'SALES',
            voucherDate:  event_date,
            sourceType:   'DAY_BILL',
            sourceId:     dayBillId,
            narration:    headerNarration,
            lines,
            postedBy:     processedBy
        });
        voucherIds.push(vid);
    }

    await markEventProcessed(event.event_id, voucherIds[voucherIds.length - 1] || null, processedBy);
    return { voucherCount: voucherIds.length };
}

// ─── BANK_TXN Handler ────────────────────────────────────────────────────────
// One voucher per classified bank transaction (real bank or oil company SOA line).
// Voucher type derived from context: PAYMENT / RECEIPT / CONTRA / JOURNAL (oil co SOA).
//
// Skip conditions:
//   • ledger_name IS NULL              — not yet classified; mark PROCESSED 0 vouchers
//   • amount = 0                       — nothing to journal
//   • is_oil_company='Y' + external_source='Bank' — SOA payment receipt line;
//                                        the real bank statement row already journals it
//   • is_oil_company='N' + external_source='Bank' + credit_amount>0
//                                      — receiving side of a contra; the paying bank's
//                                        debit row journals the transfer
//   • external_source='Static' + ledger in 'Purchase Accounts' group
//                                      — purchase invoice handler covers this
//
// Direction logic:
//   Real bank:       credit_amount>0 → Bank DR, counterpart CR
//                    debit_amount>0  → counterpart DR, Bank CR
//   Oil company SOA: credit_amount>0 → Sundry Creditor CR (charge, we owe more), counterpart DR
//                    debit_amount>0  → Sundry Creditor DR (rebate, we owe less), counterpart CR

async function processBankTxnEvent(event, processedBy) {
    const { location_code, fy_id, source_id: tBankId, event_date } = event;

    const rows = await db.sequelize.query(`
        SELECT
            tbt.t_bank_id,
            tbt.bank_id,
            tbt.trans_date,
            tbt.credit_amount,
            tbt.debit_amount,
            tbt.ledger_name,
            tbt.external_id,
            tbt.external_source,
            tbt.is_split,
            tbt.remarks,
            mb.is_oil_company,
            mb.supplier_id,
            mb.bank_name,
            mb.location_code AS bank_location
        FROM t_bank_transaction tbt
        JOIN m_bank mb ON mb.bank_id = tbt.bank_id
        WHERE tbt.t_bank_id = :tBankId
    `, { replacements: { tBankId }, type: QueryTypes.SELECT });

    if (!rows.length) throw new Error(`Bank transaction not found: t_bank_id=${tBankId}`);
    const txn = rows[0];

    // Skip: transaction not yet classified (no ledger assigned)
    if (!txn.ledger_name) {
        await markEventProcessed(event.event_id, null, processedBy);
        return { voucherCount: 0 };
    }

    const creditAmt = parseFloat(txn.credit_amount || 0);
    const debitAmt  = parseFloat(txn.debit_amount  || 0);
    const txnAmount = creditAmt > 0 ? creditAmt : debitAmt;

    if (txnAmount <= 0) {
        await markEventProcessed(event.event_id, null, processedBy);
        return { voucherCount: 0 };
    }

    const isOilCo = txn.is_oil_company === 'Y';

    // Skip: all external_source='Bank' lines on oil-company SOA (our payment receipt lines —
    // the real bank statement already journals the payment)
    if (isOilCo && txn.external_source === 'Bank') {
        await markEventProcessed(event.event_id, null, processedBy);
        return { voucherCount: 0 };
    }

    // Skip: receiving side of a contra between real banks
    if (!isOilCo && txn.external_source === 'Bank' && creditAmt > 0) {
        await markEventProcessed(event.event_id, null, processedBy);
        return { voucherCount: 0 };
    }

    // Resolve the bank's own GL ledger
    let bankLedgerId;
    if (isOilCo) {
        if (!txn.supplier_id) throw new Error(`Oil company bank '${txn.bank_name}' (bank_id:${txn.bank_id}) has no supplier_id linked — update m_bank.supplier_id`);
        bankLedgerId = await resolveLedger(location_code, 'SUPPLIER', txn.supplier_id);
        if (!bankLedgerId) throw new Error(`SUPPLIER GL ledger not found for bank '${txn.bank_name}' (supplier_id:${txn.supplier_id})`);
    } else {
        bankLedgerId = await resolveLedger(location_code, 'BANK', txn.bank_id);
        if (!bankLedgerId) throw new Error(`BANK GL ledger not found for bank '${txn.bank_name}' (bank_id:${txn.bank_id})`);
    }

    // For real bank: credit_amount → bank is DR; debit_amount → bank is CR
    // For oil company SOA: credit_amount → bank (Sundry Creditor) is CR; debit_amount → bank (SC) is DR
    // The "bankSide" determines where the bank ledger goes in the journal lines.
    const bankIsDr = isOilCo ? debitAmt > 0 : creditAmt > 0;

    const narration = txn.remarks
        ? txn.remarks
        : `${txn.bank_name} | ${txn.ledger_name} | ₹${txnAmount.toFixed(2)} | ${event_date}`;

    let lines;

    if (txn.is_split === 'Y') {
        lines = await buildSplitLines(tBankId, bankLedgerId, bankIsDr, txnAmount, narration, location_code);
    } else {
        const counterLedgerId = await resolveCounterpartLedger(txn, location_code, event.event_id, processedBy);
        if (counterLedgerId === null) {
            // resolveCounterpartLedger already called markEventProcessed for skip cases
            return { voucherCount: 0 };
        }
        lines = buildTwoLineJournal(bankLedgerId, counterLedgerId, bankIsDr, txnAmount, narration);
    }

    const voucherType = deriveBankVoucherType(txn, bankIsDr);

    const vid = await createVoucher({
        locationCode: location_code,
        fyId:         fy_id,
        voucherType,
        voucherDate:  event_date,
        sourceType:   'BANK_TXN',
        sourceId:     tBankId,
        narration,
        lines,
        postedBy:     processedBy
    });

    await markEventProcessed(event.event_id, vid, processedBy);
    return { voucherCount: 1 };
}

// ─── BOWSER_CREDIT_SALE Handler ───────────────────────────────────────────────
// Customer DR → HSD Sales CR
// No GST split — HSD is 0% GST.

async function processBowserCreditSaleEvent(event, processedBy) {
    const { location_code, fy_id, source_id: creditId, event_date } = event;

    const rows = await db.sequelize.query(`
        SELECT
            bc.credit_id,
            bc.product_id,
            p.product_name,
            bc.creditlist_id,
            cl.Company_Name AS customer_name,
            bc.quantity,
            bc.amount,
            bc.bill_no
        FROM t_bowser_credits bc
        JOIN m_product    p  ON p.product_id    = bc.product_id
        JOIN m_credit_list cl ON cl.creditlist_id = bc.creditlist_id
        WHERE bc.credit_id = :creditId
    `, { replacements: { creditId }, type: QueryTypes.SELECT });

    if (!rows.length) throw new Error(`Bowser credit sale not found: credit_id=${creditId}`);
    const row = rows[0];

    const salesLedgerId = await resolveProductLedger(location_code, row.product_id, 'SALES');
    if (!salesLedgerId) throw new Error(`Sales ledger not configured for product ${row.product_name} (id:${row.product_id})`);

    const customerLedgerId = await resolveLedger(location_code, 'CREDIT', row.creditlist_id);
    if (!customerLedgerId) throw new Error(`GL ledger not found for customer ${row.customer_name} (creditlist_id:${row.creditlist_id})`);

    const amount = parseFloat(row.amount);
    const qty    = parseFloat(row.quantity).toFixed(3);
    const narration = `${qty} ${row.product_name} | ₹${amount.toFixed(2)} | ${row.customer_name} | Bill: ${row.bill_no || '-'}`;

    const vid = await createVoucher({
        locationCode: location_code,
        fyId:         fy_id,
        voucherType:  'SALES',
        voucherDate:  event_date,
        sourceType:   'BOWSER_CREDIT_SALE',
        sourceId:     creditId,
        narration,
        lines: [
            { ledger_id: customerLedgerId, dr_amount: amount, cr_amount: 0,      narration },
            { ledger_id: salesLedgerId,    dr_amount: 0,      cr_amount: amount, narration }
        ],
        postedBy: processedBy
    });

    await markEventProcessed(event.event_id, vid, processedBy);
    return { voucherCount: 1 };
}

// ─── BOWSER_CASH_SALE Handler ─────────────────────────────────────────────────
// Cash DR → HSD Sales CR

async function processBowserCashSaleEvent(event, processedBy) {
    const { location_code, fy_id, source_id: cashsaleId, event_date } = event;

    const rows = await db.sequelize.query(`
        SELECT
            bcs.cashsale_id,
            bcs.product_id,
            p.product_name,
            bcs.amount
        FROM t_bowser_cashsales bcs
        JOIN m_product p ON p.product_id = bcs.product_id
        WHERE bcs.cashsale_id = :cashsaleId
    `, { replacements: { cashsaleId }, type: QueryTypes.SELECT });

    if (!rows.length) throw new Error(`Bowser cash sale not found: cashsale_id=${cashsaleId}`);
    const row = rows[0];

    if (parseFloat(row.amount) <= 0) {
        await markEventProcessed(event.event_id, null, processedBy);
        return { voucherCount: 0 };
    }

    const salesLedgerId = await resolveProductLedger(location_code, row.product_id, 'SALES');
    if (!salesLedgerId) throw new Error(`Sales ledger not configured for product ${row.product_name} (id:${row.product_id})`);

    const cashLedgerId = await resolveCashLedger(location_code);
    if (!cashLedgerId) throw new Error(`Cash-in-Hand ledger not found for location ${location_code}`);

    const amount    = parseFloat(row.amount);
    const narration = `${row.product_name} Cash Sale | ₹${amount.toFixed(2)} | ${event_date}`;

    const vid = await createVoucher({
        locationCode: location_code,
        fyId:         fy_id,
        voucherType:  'SALES',
        voucherDate:  event_date,
        sourceType:   'BOWSER_CASH_SALE',
        sourceId:     cashsaleId,
        narration,
        lines: [
            { ledger_id: cashLedgerId,  dr_amount: amount, cr_amount: 0,      narration },
            { ledger_id: salesLedgerId, dr_amount: 0,      cr_amount: amount, narration }
        ],
        postedBy: processedBy
    });

    await markEventProcessed(event.event_id, vid, processedBy);
    return { voucherCount: 1 };
}

// ─── BOWSER_DIGITAL_SALE Handler ──────────────────────────────────────────────
// Digital vendor DR → HSD Sales CR
// Product resolved from m_bowser (via t_bowser_closing) since t_bowser_digital_sales
// has no product_id column.

async function processBowserDigitalSaleEvent(event, processedBy) {
    const { location_code, fy_id, source_id: digitalId, event_date } = event;

    const rows = await db.sequelize.query(`
        SELECT
            bds.digital_id,
            bds.digital_vendor_id,
            bds.amount,
            mb.product_id,
            p.product_name,
            cl.Company_Name AS vendor_name
        FROM t_bowser_digital_sales bds
        JOIN t_bowser_closing tbc ON tbc.bowser_closing_id = bds.bowser_closing_id
        JOIN m_bowser         mb  ON mb.bowser_id          = tbc.bowser_id
        JOIN m_product        p   ON p.product_id          = mb.product_id
        JOIN m_credit_list    cl  ON cl.creditlist_id      = bds.digital_vendor_id
        WHERE bds.digital_id = :digitalId
    `, { replacements: { digitalId }, type: QueryTypes.SELECT });

    if (!rows.length) throw new Error(`Bowser digital sale not found: digital_id=${digitalId}`);
    const row = rows[0];

    if (parseFloat(row.amount) <= 0) {
        await markEventProcessed(event.event_id, null, processedBy);
        return { voucherCount: 0 };
    }

    const salesLedgerId = await resolveProductLedger(location_code, row.product_id, 'SALES');
    if (!salesLedgerId) throw new Error(`Sales ledger not configured for product ${row.product_name} (id:${row.product_id})`);

    const vendorLedgerId = await resolveLedger(location_code, 'CREDIT', row.digital_vendor_id);
    if (!vendorLedgerId) throw new Error(`GL ledger not found for digital vendor ${row.vendor_name} (creditlist_id:${row.digital_vendor_id})`);

    const amount    = parseFloat(row.amount);
    const narration = `${row.product_name} Digital Sale | ₹${amount.toFixed(2)} | ${row.vendor_name} | ${event_date}`;

    const vid = await createVoucher({
        locationCode: location_code,
        fyId:         fy_id,
        voucherType:  'SALES',
        voucherDate:  event_date,
        sourceType:   'BOWSER_DIGITAL_SALE',
        sourceId:     digitalId,
        narration,
        lines: [
            { ledger_id: vendorLedgerId, dr_amount: amount, cr_amount: 0,      narration },
            { ledger_id: salesLedgerId,  dr_amount: 0,      cr_amount: amount, narration }
        ],
        postedBy: processedBy
    });

    await markEventProcessed(event.event_id, vid, processedBy);
    return { voucherCount: 1 };
}

// ─── LUBES_INVOICE Handler ────────────────────────────────────────────────────
// Supplier CR (sum of all line amounts) → Purchase DR + Input CGST DR + Input SGST DR per line.
// Skips silently if invoice is still DRAFT — UPDATE trigger fires again when it transitions to CLOSED.

async function processLubesInvoiceEvent(event, processedBy) {
    const { location_code, fy_id, source_id: lubesHdrId, event_date } = event;

    const hdrs = await db.sequelize.query(`
        SELECT
            h.lubes_hdr_id,
            h.closing_status,
            h.invoice_date,
            h.invoice_no,
            s.supplier_name,
            h.supplier_id
        FROM t_lubes_inv_hdr h
        JOIN m_supplier s ON s.supplier_id = h.supplier_id
        WHERE h.lubes_hdr_id = :lubesHdrId
    `, { replacements: { lubesHdrId }, type: QueryTypes.SELECT });

    if (!hdrs.length) throw new Error(`Lubes invoice not found: lubes_hdr_id=${lubesHdrId}`);
    const hdr = hdrs[0];

    // DRAFT gate — engine will re-run when UPDATE trigger fires on DRAFT→CLOSED transition
    if (hdr.closing_status === 'DRAFT') {
        await markEventProcessed(event.event_id, null, processedBy);
        return { voucherCount: 0 };
    }

    const lines_rows = await db.sequelize.query(`
        SELECT
            l.line_id,
            l.product_id,
            p.product_name,
            l.taxable_value,
            l.cgst_amount,
            l.sgst_amount
        FROM t_lubes_inv_lines l
        JOIN m_product p ON p.product_id = l.product_id
        WHERE l.lubes_hdr_id = :lubesHdrId
          AND l.taxable_value > 0
    `, { replacements: { lubesHdrId }, type: QueryTypes.SELECT });

    if (!lines_rows.length) throw new Error(`No lines found for lubes invoice lubes_hdr_id=${lubesHdrId}`);

    const supplierLedgerId = await resolveLedger(location_code, 'SUPPLIER', hdr.supplier_id);
    if (!supplierLedgerId) throw new Error(`Supplier GL ledger not found for ${hdr.supplier_name} (supplier_id:${hdr.supplier_id})`);

    const narration = `Lubes Invoice ${hdr.invoice_no || lubesHdrId} | ${hdr.supplier_name} | ${event_date}`;
    const journalLines = [];
    let totalCr = 0;

    for (const ln of lines_rows) {
        const taxable = parseFloat(ln.taxable_value);
        const cgst    = parseFloat(ln.cgst_amount || 0);
        const sgst    = parseFloat(ln.sgst_amount || 0);
        totalCr      += taxable + cgst + sgst;

        const purchaseLedgerId = await resolveProductLedger(location_code, ln.product_id, 'PURCHASE');
        if (!purchaseLedgerId) throw new Error(`PURCHASE ledger not configured for product ${ln.product_name} (id:${ln.product_id})`);

        const lineNarration = `${ln.product_name} | ₹${taxable.toFixed(2)} + GST | ${narration}`;
        journalLines.push({ ledger_id: purchaseLedgerId, dr_amount: taxable, cr_amount: 0, narration: lineNarration });

        if (cgst > 0) {
            const cgstLedgerId = await resolveProductLedger(location_code, ln.product_id, 'INPUT_CGST');
            if (!cgstLedgerId) throw new Error(`INPUT_CGST ledger not mapped for product ${ln.product_name} — configure it at /products/ledger-map`);
            journalLines.push({ ledger_id: cgstLedgerId, dr_amount: cgst, cr_amount: 0, narration: lineNarration });
        }
        if (sgst > 0) {
            const sgstLedgerId = await resolveProductLedger(location_code, ln.product_id, 'INPUT_SGST');
            if (!sgstLedgerId) throw new Error(`INPUT_SGST ledger not mapped for product ${ln.product_name} — configure it at /products/ledger-map`);
            journalLines.push({ ledger_id: sgstLedgerId, dr_amount: sgst, cr_amount: 0, narration: lineNarration });
        }
    }

    // Supplier CR — sum of all line amounts (guarantees balance regardless of header rounding)
    journalLines.push({ ledger_id: supplierLedgerId, dr_amount: 0, cr_amount: totalCr, narration });

    const vid = await createVoucher({
        locationCode: location_code,
        fyId:         fy_id,
        voucherType:  'PURCHASE',
        voucherDate:  event_date,
        sourceType:   'LUBES_INVOICE',
        sourceId:     lubesHdrId,
        narration,
        lines:        journalLines,
        postedBy:     processedBy
    });

    await markEventProcessed(event.event_id, vid, processedBy);
    return { voucherCount: 1 };
}

// ─── TANK_INVOICE Handler ─────────────────────────────────────────────────────
// Supplier CR (sum of product lines + charges) →
//   Per t_tank_invoice_dtl: DR Product Purchase (total_line_amount)
//   Per t_tank_invoice_charges: DR charge ledger by name (resolveLedgerByName)
//
// charge_type is free text in t_tank_invoice_charges — admin must create a GL ledger
// with the exact same name, otherwise the engine throws a descriptive error.

async function processTankInvoiceEvent(event, processedBy) {
    const { location_code, fy_id, source_id: invoiceId, event_date } = event;

    const hdrs = await db.sequelize.query(`
        SELECT
            ti.id,
            ti.invoice_no,
            ti.invoice_date,
            ti.supplier_id,
            s.supplier_name
        FROM t_tank_invoice ti
        JOIN m_supplier s ON s.supplier_id = ti.supplier_id
        WHERE ti.id = :invoiceId
    `, { replacements: { invoiceId }, type: QueryTypes.SELECT });

    if (!hdrs.length) throw new Error(`Tank invoice not found: id=${invoiceId}`);
    const hdr = hdrs[0];

    const supplierLedgerId = await resolveLedger(location_code, 'SUPPLIER', hdr.supplier_id);
    if (!supplierLedgerId) throw new Error(`Supplier GL ledger not found for ${hdr.supplier_name} (supplier_id:${hdr.supplier_id})`);

    const narration = `Tank Invoice ${hdr.invoice_no || invoiceId} | ${hdr.supplier_name} | ${event_date}`;
    const journalLines = [];
    let totalCr = 0;

    // Product purchase lines
    const dtlRows = await db.sequelize.query(`
        SELECT
            d.dtl_id,
            d.product_id,
            p.product_name,
            d.total_line_amount
        FROM t_tank_invoice_dtl d
        JOIN m_product p ON p.product_id = d.product_id
        WHERE d.invoice_id = :invoiceId
          AND d.total_line_amount > 0
    `, { replacements: { invoiceId }, type: QueryTypes.SELECT });

    for (const dtl of dtlRows) {
        const lineAmt = parseFloat(dtl.total_line_amount);
        totalCr      += lineAmt;

        const purchaseLedgerId = await resolveProductLedger(location_code, dtl.product_id, 'PURCHASE');
        if (!purchaseLedgerId) throw new Error(`PURCHASE ledger not configured for product ${dtl.product_name} (id:${dtl.product_id})`);

        journalLines.push({
            ledger_id:  purchaseLedgerId,
            dr_amount:  lineAmt,
            cr_amount:  0,
            narration:  `${dtl.product_name} | ₹${lineAmt.toFixed(2)} | ${narration}`
        });
    }

    // Charge lines (free-text charge_type → GL ledger by name)
    const chargeRows = await db.sequelize.query(`
        SELECT charge_type, amount
        FROM t_tank_invoice_charges
        WHERE invoice_id = :invoiceId
          AND amount > 0
    `, { replacements: { invoiceId }, type: QueryTypes.SELECT });

    for (const ch of chargeRows) {
        const chargeAmt = parseFloat(ch.amount);
        totalCr        += chargeAmt;

        const info = await resolveLedgerByName(location_code, ch.charge_type);
        if (!info) throw new Error(`GL ledger '${ch.charge_type}' not found for location ${location_code} — create a ledger with this exact name to map the charge`);

        journalLines.push({
            ledger_id:  info.ledger_id,
            dr_amount:  chargeAmt,
            cr_amount:  0,
            narration:  `${ch.charge_type} | ₹${chargeAmt.toFixed(2)} | ${narration}`
        });
    }

    if (!journalLines.length) throw new Error(`Tank invoice id=${invoiceId} has no product lines or charges to journal`);

    // Supplier CR — sum of all DR lines (guarantees balance regardless of header rounding)
    journalLines.push({ ledger_id: supplierLedgerId, dr_amount: 0, cr_amount: totalCr, narration });

    const vid = await createVoucher({
        locationCode: location_code,
        fyId:         fy_id,
        voucherType:  'PURCHASE',
        voucherDate:  event_date,
        sourceType:   'TANK_INVOICE',
        sourceId:     invoiceId,
        narration,
        lines:        journalLines,
        postedBy:     processedBy
    });

    await markEventProcessed(event.event_id, vid, processedBy);
    return { voucherCount: 1 };
}

// Derives the Tally voucher type from bank transaction context.
//   CONTRA  — inter-bank transfer (external_source='Bank', debit/paying side)
//   PAYMENT — money leaves the bank (bank is CR side)
//   RECEIPT — money enters the bank (bank is DR side)
//   JOURNAL — oil company SOA entries (supplier account adjustments)
function deriveBankVoucherType(txn, bankIsDr) {
    if (txn.is_oil_company === 'Y') return 'JOURNAL';
    if (txn.external_source === 'Bank') return 'CONTRA';
    return bankIsDr ? 'RECEIPT' : 'PAYMENT';
}

// Returns counterpart ledger_id, or null if the event was already marked PROCESSED (skip).
// Throws on unresolvable ledger.
async function resolveCounterpartLedger(txn, locationCode, eventId, processedBy) {
    const { external_source, external_id, ledger_name } = txn;

    if (external_source === 'Static') {
        const info = await resolveLedgerByName(locationCode, ledger_name);
        if (!info) throw new Error(`Static GL ledger '${ledger_name}' not found for location ${locationCode}`);
        if (info.group_name === 'Purchase Accounts') {
            // Purchase invoices are journaled by the PURCHASE_INVOICE handler — skip here
            await markEventProcessed(eventId, null, processedBy);
            return null;
        }
        return info.ledger_id;
    }

    if (external_source === 'Credit') {
        const id = await resolveLedger(locationCode, 'CREDIT', external_id);
        if (!id) throw new Error(`CREDIT GL ledger not found for creditlist_id=${external_id}`);
        return id;
    }

    if (external_source === 'Supplier') {
        const id = await resolveLedger(locationCode, 'SUPPLIER', external_id);
        if (!id) throw new Error(`SUPPLIER GL ledger not found for supplier_id=${external_id}`);
        return id;
    }

    if (external_source === 'Bank') {
        // Debit-side of a real-bank contra (credit side was already skipped above)
        const id = await resolveLedger(locationCode, 'BANK', external_id);
        if (!id) throw new Error(`BANK GL ledger not found for contra bank_id=${external_id}`);
        return id;
    }

    throw new Error(`Cannot resolve counterpart ledger: external_source='${external_source}', external_id=${external_id}, ledger_name='${ledger_name}'`);
}

async function buildSplitLines(tBankId, bankLedgerId, bankIsDr, txnAmount, narration, locationCode) {
    const splits = await db.sequelize.query(`
        SELECT split_id, amount, ledger_name, external_id, external_source, remarks
        FROM t_bank_transaction_splits
        WHERE t_bank_id = :tBankId
        ORDER BY split_id
    `, { replacements: { tBankId }, type: QueryTypes.SELECT });

    if (!splits.length) throw new Error(`Split transaction t_bank_id=${tBankId} has no split rows`);

    const lines = [];
    // Bank line covers the total
    lines.push(bankIsDr
        ? { ledger_id: bankLedgerId, dr_amount: txnAmount, cr_amount: 0,         narration }
        : { ledger_id: bankLedgerId, dr_amount: 0,         cr_amount: txnAmount, narration }
    );

    for (const split of splits) {
        const splitAmt = parseFloat(split.amount);
        const splitNarration = split.remarks || narration;
        const counterLedgerId = await resolveSplitCounterLedger(split, locationCode);
        lines.push(bankIsDr
            ? { ledger_id: counterLedgerId, dr_amount: 0,        cr_amount: splitAmt, narration: splitNarration }
            : { ledger_id: counterLedgerId, dr_amount: splitAmt, cr_amount: 0,        narration: splitNarration }
        );
    }

    return lines;
}

async function resolveSplitCounterLedger(split, locationCode) {
    const { external_source, external_id, ledger_name, split_id } = split;
    const errCtx = `split_id=${split_id}`;

    if (external_source === 'Static') {
        const info = await resolveLedgerByName(locationCode, ledger_name);
        if (!info) throw new Error(`Static GL ledger '${ledger_name}' not found for ${errCtx}`);
        return info.ledger_id;
    }
    if (external_source === 'Credit') {
        const id = await resolveLedger(locationCode, 'CREDIT', external_id);
        if (!id) throw new Error(`CREDIT GL ledger not found for creditlist_id=${external_id} (${errCtx})`);
        return id;
    }
    if (external_source === 'Supplier') {
        const id = await resolveLedger(locationCode, 'SUPPLIER', external_id);
        if (!id) throw new Error(`SUPPLIER GL ledger not found for supplier_id=${external_id} (${errCtx})`);
        return id;
    }
    if (external_source === 'Bank') {
        const id = await resolveLedger(locationCode, 'BANK', external_id);
        if (!id) throw new Error(`BANK GL ledger not found for bank_id=${external_id} (${errCtx})`);
        return id;
    }
    throw new Error(`Cannot resolve split ledger: source='${external_source}', id=${external_id} (${errCtx})`);
}

function buildTwoLineJournal(bankLedgerId, counterLedgerId, bankIsDr, amount, narration) {
    if (bankIsDr) {
        return [
            { ledger_id: bankLedgerId,    dr_amount: amount, cr_amount: 0,      narration },
            { ledger_id: counterLedgerId, dr_amount: 0,      cr_amount: amount, narration }
        ];
    } else {
        return [
            { ledger_id: counterLedgerId, dr_amount: amount, cr_amount: 0,      narration },
            { ledger_id: bankLedgerId,    dr_amount: 0,      cr_amount: amount, narration }
        ];
    }
}

// ─── Voucher Utilities ────────────────────────────────────────────────────────

async function createVoucher({ locationCode, fyId, voucherType, voucherDate, sourceType, sourceId, narration, lines, postedBy }) {
    const totalDr = lines.reduce((s, l) => s + (l.dr_amount || 0), 0);
    const totalCr = lines.reduce((s, l) => s + (l.cr_amount || 0), 0);
    if (Math.abs(totalDr - totalCr) > 0.005) {
        throw new Error(`Voucher does not balance: DR ${totalDr.toFixed(2)} vs CR ${totalCr.toFixed(2)}`);
    }

    const voucherNo = await generateVoucherNo(locationCode, fyId, voucherType);

    const [voucherId] = await db.sequelize.query(`
        INSERT INTO gl_journal_headers
            (location_code, fy_id, voucher_type, voucher_date, voucher_no,
             narration, source_type, source_id, is_reversal, is_exported,
             posted_by, created_by)
        VALUES
            (:locationCode, :fyId, :voucherType, :voucherDate, :voucherNo,
             :narration, :sourceType, :sourceId, 'N', 'N',
             :postedBy, :postedBy)
    `, {
        replacements: { locationCode, fyId, voucherType, voucherDate, voucherNo, narration, sourceType, sourceId, postedBy },
        type: QueryTypes.INSERT
    });

    for (let i = 0; i < lines.length; i++) {
        const { ledger_id, dr_amount = 0, cr_amount = 0, narration: lineNarration = null } = lines[i];
        await db.sequelize.query(`
            INSERT INTO gl_journal_lines
                (voucher_id, line_no, ledger_id, dr_amount, cr_amount, narration, created_by)
            VALUES
                (:voucherId, :lineNo, :ledgerId, :drAmount, :crAmount, :lineNarration, :postedBy)
        `, {
            replacements: { voucherId, lineNo: i + 1, ledgerId: ledger_id, drAmount: dr_amount, crAmount: cr_amount, lineNarration, postedBy },
            type: QueryTypes.INSERT
        });
    }

    return voucherId;
}

async function reverseExistingVouchers(locationCode, sourceType, sourceId, reversedBy) {
    const existing = await db.sequelize.query(`
        SELECT voucher_id, voucher_type, voucher_date, fy_id, narration
        FROM gl_journal_headers
        WHERE location_code = :locationCode
          AND source_type   = :sourceType
          AND source_id     = :sourceId
          AND is_reversal   = 'N'
    `, {
        replacements: { locationCode, sourceType, sourceId },
        type: QueryTypes.SELECT
    });

    for (const v of existing) {
        const lines = await db.sequelize.query(`
            SELECT ledger_id, cr_amount AS dr_amount, dr_amount AS cr_amount
            FROM gl_journal_lines
            WHERE voucher_id = :voucherId
        `, {
            replacements: { voucherId: v.voucher_id },
            type: QueryTypes.SELECT
        });

        const voucherNo = await generateVoucherNo(locationCode, v.fy_id, v.voucher_type);

        const [reversalId] = await db.sequelize.query(`
            INSERT INTO gl_journal_headers
                (location_code, fy_id, voucher_type, voucher_date, voucher_no,
                 narration, source_type, source_id, is_reversal, reversal_of_voucher_id,
                 is_exported, posted_by, created_by)
            VALUES
                (:locationCode, :fyId, :voucherType, NOW(), :voucherNo,
                 :narration, :sourceType, :sourceId, 'Y', :originalId,
                 'N', :reversedBy, :reversedBy)
        `, {
            replacements: {
                locationCode,
                fyId:        v.fy_id,
                voucherType: v.voucher_type,
                voucherNo,
                narration:   `REVERSAL of ${v.voucher_type} — ${v.narration || ''}`,
                sourceType,
                sourceId,
                originalId:  v.voucher_id,
                reversedBy
            },
            type: QueryTypes.INSERT
        });

        for (let i = 0; i < lines.length; i++) {
            const { ledger_id, dr_amount, cr_amount } = lines[i];
            await db.sequelize.query(`
                INSERT INTO gl_journal_lines
                    (voucher_id, line_no, ledger_id, dr_amount, cr_amount, created_by)
                VALUES (:reversalId, :lineNo, :ledgerId, :drAmount, :crAmount, :reversedBy)
            `, {
                replacements: { reversalId, lineNo: i + 1, ledgerId: ledger_id, drAmount: dr_amount, crAmount: cr_amount, reversedBy },
                type: QueryTypes.INSERT
            });
        }
    }
}

async function generateVoucherNo(locationCode, fyId, voucherType) {
    const prefix = VOUCHER_PREFIXES[voucherType] || 'JNL';
    const result = await db.sequelize.query(`
        SELECT COALESCE(MAX(
            CAST(SUBSTRING(voucher_no, LOCATE('-', voucher_no) + 1) AS UNSIGNED)
        ), 0) + 1 AS next_no
        FROM gl_journal_headers
        WHERE location_code = :locationCode
          AND fy_id         = :fyId
          AND voucher_type  = :voucherType
          AND voucher_no IS NOT NULL
    `, {
        replacements: { locationCode, fyId, voucherType },
        type: QueryTypes.SELECT
    });
    const nextNo = result[0].next_no;
    return `${prefix}-${String(nextNo).padStart(4, '0')}`;
}

// ─── Ledger Resolvers ─────────────────────────────────────────────────────────

async function resolveLedger(locationCode, sourceType, sourceId) {
    const rows = await db.sequelize.query(`
        SELECT ledger_id FROM gl_ledgers
        WHERE location_code = :locationCode
          AND source_type   = :sourceType
          AND source_id     = :sourceId
        LIMIT 1
    `, {
        replacements: { locationCode, sourceType, sourceId },
        type: QueryTypes.SELECT
    });
    return rows[0] ? rows[0].ledger_id : null;
}

async function resolveProductLedger(locationCode, productId, mapType) {
    const rows = await db.sequelize.query(`
        SELECT ledger_id FROM gl_product_ledger_map
        WHERE location_code = :locationCode
          AND product_id    = :productId
          AND map_type      = :mapType
        LIMIT 1
    `, {
        replacements: { locationCode, productId, mapType },
        type: QueryTypes.SELECT
    });
    return rows[0] ? rows[0].ledger_id : null;
}

async function resolveLedgerByName(locationCode, ledgerName) {
    const rows = await db.sequelize.query(`
        SELECT l.ledger_id, g.group_name
        FROM gl_ledgers l
        JOIN gl_ledger_groups g ON g.group_id = l.group_id
        WHERE l.location_code = :locationCode
          AND l.ledger_name   = :ledgerName
          AND l.active_flag   = 'Y'
        LIMIT 1
    `, {
        replacements: { locationCode, ledgerName },
        type: QueryTypes.SELECT
    });
    return rows[0] || null;
}

async function resolveCashLedger(locationCode) {
    const rows = await db.sequelize.query(`
        SELECT l.ledger_id FROM gl_ledgers l
        JOIN gl_ledger_groups g ON g.group_id = l.group_id
        WHERE l.location_code = :locationCode
          AND g.group_name    = 'Cash-in-Hand'
          AND l.active_flag   = 'Y'
        LIMIT 1
    `, {
        replacements: { locationCode },
        type: QueryTypes.SELECT
    });
    return rows[0] ? rows[0].ledger_id : null;
}

// ─── Shift Gate ───────────────────────────────────────────────────────────────
// Returns a Set of 'YYYY-MM-DD' dates within the range where t_closing rows
// are still in DRAFT status.  Shift-bound event types (CREDIT_SALE, CASH_SALE,
// DAY_BILL) are skipped for these dates — left UNPROCESSED until the shift closes.

async function getOpenShiftDates(locationCode, fromDate, toDate) {
    const rows = await db.sequelize.query(`
        SELECT DISTINCT DATE_FORMAT(closing_date, '%Y-%m-%d') AS blocked_date
        FROM t_closing
        WHERE location_code  = :locationCode
          AND closing_date   BETWEEN :fromDate AND :toDate
          AND closing_status = 'DRAFT'
    `, {
        replacements: { locationCode, fromDate, toDate },
        type: QueryTypes.SELECT
    });
    return new Set(rows.map(r => r.blocked_date));
}

async function getOpenBowserDates(locationCode, fromDate, toDate) {
    const rows = await db.sequelize.query(`
        SELECT DISTINCT DATE_FORMAT(closing_date, '%Y-%m-%d') AS blocked_date
        FROM t_bowser_closing
        WHERE location_code = :locationCode
          AND closing_date  BETWEEN :fromDate AND :toDate
          AND status        = 'DRAFT'
    `, {
        replacements: { locationCode, fromDate, toDate },
        type: QueryTypes.SELECT
    });
    return new Set(rows.map(r => r.blocked_date));
}

// ─── Event Status Helpers ─────────────────────────────────────────────────────

async function markEventProcessed(eventId, voucherId, processedBy) {
    await db.sequelize.query(`
        UPDATE gl_accounting_events
        SET event_status  = 'PROCESSED',
            voucher_id    = :voucherId,
            processed_at  = NOW(),
            processed_by  = :processedBy
        WHERE event_id = :eventId
    `, {
        replacements: { eventId, voucherId, processedBy },
        type: QueryTypes.UPDATE
    });
}

async function markEventError(eventId, errorMessage) {
    await db.sequelize.query(`
        UPDATE gl_accounting_events
        SET event_status  = 'ERROR',
            error_message = :errorMessage,
            processed_at  = NOW()
        WHERE event_id = :eventId
    `, {
        replacements: { eventId, errorMessage: String(errorMessage).substring(0, 1000) },
        type: QueryTypes.UPDATE
    });
}
