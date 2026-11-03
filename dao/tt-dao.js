// dao/tt-dao.js — Tank Truck Freight (Transport module): vendors, trucks, freight bills.
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

const select = (sql, replacements, transaction) =>
    db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// Bank receipt label for the bank part of the oil company's payment
const receiptLabel = (oilCompany) => `TT FREIGHT - ${oilCompany}`;

const INVOICE_COLUMNS = [
    'location_code', 'vendor_id', 'bill_no', 'bill_date', 'period_from', 'period_to', 'generated_on', 'reverse_charge',
    'recipient_name', 'recipient_gstin', 'recipient_address', 'sac_code', 'gst_rate', 'gross_amount', 'penalty_amount',
    'taxable_value', 'cgst_amount', 'sgst_amount', 'igst_amount', 'bill_cgst', 'bill_sgst', 'bill_igst', 'invoice_value',
    'tds_percent', 'tds_amount', 'net_receivable', 'trip_count', 'total_kl', 'vehicles', 'file_name', 'notes',
    'created_by', 'updated_by'
];
const LINE_COLUMNS = [
    'invoice_id', 'sno', 'vehicle_no', 'delivery_invoice_no', 'item_no', 'delivery_date', 'ship_to_code', 'ship_to_name',
    'material_code', 'qty_kl', 'shortage', 'rtd_p', 'rtd_h', 'rtd_hh', 'rate_p', 'rate_h', 'rate_hh',
    'gross_amount', 'penalty_amount', 'igst_amount', 'cgst_amount', 'sgst_amount'
];

const TtDao = {
    receiptLabel,

    // ── Vendors ─────────────────────────────────────────────────────────────
    getVendors: (locationCode) => select(`
        SELECT v.*, DATE_FORMAT(v.start_date, '%Y-%m-%d') AS start_date_iso,
               dl.ledger_name AS debtor_ledger, il.ledger_name AS income_ledger, tl.ledger_name AS tds_ledger,
               CONCAT(b.bank_name, ' - ', b.account_number) AS receipt_bank,
               (SELECT COUNT(*) FROM t_tt_invoice i WHERE i.vendor_id = v.vendor_id) AS invoice_count
        FROM m_tt_vendor v
        LEFT JOIN gl_ledgers dl ON dl.ledger_id = v.debtor_ledger_id
        LEFT JOIN gl_ledgers il ON il.ledger_id = v.income_ledger_id
        LEFT JOIN gl_ledgers tl ON tl.ledger_id = v.tds_ledger_id
        LEFT JOIN m_bank b ON b.bank_id = v.receipt_bank_id
        WHERE v.location_code = :locationCode
        ORDER BY v.active_flag DESC, v.oil_company, v.vendor_code
    `, { locationCode }),

    getVendor: async (locationCode, vendorId) => {
        const [v] = await select(`SELECT * FROM m_tt_vendor WHERE location_code = :locationCode AND vendor_id = :vendorId`,
            { locationCode, vendorId });
        return v || null;
    },

    getVendorByCode: async (locationCode, oilCompany, vendorCode) => {
        const [v] = await select(`
            SELECT * FROM m_tt_vendor
            WHERE location_code = :locationCode AND oil_company = :oilCompany AND vendor_code = :vendorCode AND active_flag = 'Y'
        `, { locationCode, oilCompany, vendorCode });
        return v || null;
    },

    updateVendor: (locationCode, vendorId, d, by) => db.sequelize.transaction(async (t) => {
        await db.sequelize.query(`
            UPDATE m_tt_vendor
            SET vendor_name = :vendor_name, sac_code = :sac_code, gst_rate = :gst_rate, tds_percent = :tds_percent,
                debtor_ledger_id = :debtor_ledger_id, income_ledger_id = :income_ledger_id, tds_ledger_id = :tds_ledger_id,
                receipt_bank_id = :receipt_bank_id, start_date = :start_date, active_flag = :active_flag, notes = :notes,
                updated_by = :by
            WHERE location_code = :locationCode AND vendor_id = :vendorId
        `, { replacements: { ...d, locationCode, vendorId, by }, type: QueryTypes.UPDATE, transaction: t });
        await syncReceiptRule(locationCode, vendorId, by, t);
    }),

    // Ledgers offered in the vendor settings: debtors, incomes, current assets
    getLedgerChoices: (locationCode) => select(`
        SELECT l.ledger_id, l.ledger_name, g.group_name,
               CASE
                   WHEN g.group_name = 'Sundry Debtors' THEN 'debtor'
                   WHEN g.group_nature = 'INCOME' THEN 'income'
                   WHEN g.group_nature = 'ASSETS' AND g.group_name NOT IN ('Sundry Debtors', 'Bank Accounts', 'Cash-in-Hand') THEN 'asset'
               END AS kind
        FROM gl_ledgers l
        JOIN gl_ledger_groups g ON g.group_id = l.group_id
        WHERE l.location_code = :locationCode AND l.active_flag = 'Y'
          AND (g.group_name = 'Sundry Debtors' AND l.source_type IN ('SYSTEM', 'STATIC')
               OR g.group_nature = 'INCOME' AND l.source_type IN ('SYSTEM', 'STATIC')
               OR g.group_nature = 'ASSETS' AND l.source_type IN ('SYSTEM', 'STATIC')
                  AND g.group_name NOT IN ('Sundry Debtors', 'Bank Accounts', 'Cash-in-Hand'))
        ORDER BY l.ledger_name
    `, { locationCode }),

    getBanks: (locationCode) => select(`
        SELECT bank_id, bank_name, account_number
        FROM m_bank
        WHERE location_code = :locationCode AND active_flag = 'Y' AND COALESCE(is_oil_company, 'N') <> 'Y'
        ORDER BY bank_name, account_number
    `, { locationCode }),

    // ── Trucks ──────────────────────────────────────────────────────────────
    getVehicles: (locationCode) => select(`
        SELECT h.*, v.oil_company, v.vendor_code,
               DATE_FORMAT(h.insurance_expiry, '%Y-%m-%d') AS insurance_expiry_iso,
               DATE_FORMAT(h.fc_expiry, '%Y-%m-%d') AS fc_expiry_iso,
               DATE_FORMAT(h.permit_expiry, '%Y-%m-%d') AS permit_expiry_iso,
               DATE_FORMAT(h.tax_expiry, '%Y-%m-%d') AS tax_expiry_iso,
               (SELECT COUNT(*) FROM t_tt_invoice_line l JOIN t_tt_invoice i ON i.invoice_id = l.invoice_id
                WHERE i.location_code = h.location_code AND l.vehicle_no = h.vehicle_no) AS trip_count
        FROM m_tt_vehicle h
        LEFT JOIN m_tt_vendor v ON v.vendor_id = h.vendor_id
        WHERE h.location_code = :locationCode
        ORDER BY h.active_flag DESC, h.vehicle_no
    `, { locationCode }),

    getVehicle: async (locationCode, vehicleId) => {
        const [v] = await select(`SELECT * FROM m_tt_vehicle WHERE location_code = :locationCode AND vehicle_id = :vehicleId`,
            { locationCode, vehicleId });
        return v || null;
    },

    vehicleNoExists: async (locationCode, vehicleNo, exceptId) => {
        const [r] = await select(`
            SELECT COUNT(*) AS n FROM m_tt_vehicle
            WHERE location_code = :locationCode AND vehicle_no = :vehicleNo AND vehicle_id <> :exceptId
        `, { locationCode, vehicleNo, exceptId: exceptId || 0 });
        return Number(r.n) > 0;
    },

    saveVehicle: async (locationCode, vehicleId, d, by) => {
        const replacements = { ...d, locationCode, vehicleId, by };
        if (vehicleId) {
            await db.sequelize.query(`
                UPDATE m_tt_vehicle
                SET vehicle_no = :vehicle_no, vendor_id = :vendor_id, capacity_kl = :capacity_kl, fleet_card_id = :fleet_card_id,
                    insurance_expiry = :insurance_expiry, fc_expiry = :fc_expiry, permit_expiry = :permit_expiry,
                    tax_expiry = :tax_expiry, active_flag = :active_flag, notes = :notes, updated_by = :by
                WHERE location_code = :locationCode AND vehicle_id = :vehicleId
            `, { replacements, type: QueryTypes.UPDATE });
            return vehicleId;
        }
        const [id] = await db.sequelize.query(`
            INSERT INTO m_tt_vehicle (location_code, vehicle_no, vendor_id, capacity_kl, fleet_card_id, insurance_expiry,
                                      fc_expiry, permit_expiry, tax_expiry, active_flag, notes, created_by, updated_by)
            VALUES (:locationCode, :vehicle_no, :vendor_id, :capacity_kl, :fleet_card_id, :insurance_expiry,
                    :fc_expiry, :permit_expiry, :tax_expiry, :active_flag, :notes, :by, :by)
        `, { replacements, type: QueryTypes.INSERT });
        return id;
    },

    deleteVehicle: (locationCode, vehicleId) => db.sequelize.query(`
        DELETE FROM m_tt_vehicle WHERE location_code = :locationCode AND vehicle_id = :vehicleId
    `, { replacements: { locationCode, vehicleId }, type: QueryTypes.DELETE }),

    // ── Freight bills ───────────────────────────────────────────────────────
    getExistingBillNos: async (locationCode, billNos) => {
        if (!billNos.length) return new Set();
        const rows = await select(`
            SELECT bill_no FROM t_tt_invoice WHERE location_code = :locationCode AND bill_no IN (:billNos)
        `, { locationCode, billNos });
        return new Set(rows.map(r => r.bill_no));
    },

    // bills: [{ ...t_tt_invoice columns, lines: [...] }]. Trucks not in the master are added.
    createInvoices: (locationCode, bills, by) => db.sequelize.transaction(async (t) => {
        const ids = [];
        for (const bill of bills) {
            const row = { ...bill, location_code: locationCode, created_by: by, updated_by: by };
            const [invoiceId] = await db.sequelize.query(`
                INSERT INTO t_tt_invoice (${INVOICE_COLUMNS.join(', ')})
                VALUES (${INVOICE_COLUMNS.map(c => ':' + c).join(', ')})
            `, { replacements: Object.fromEntries(INVOICE_COLUMNS.map(c => [c, row[c] === undefined ? null : row[c]])),
                type: QueryTypes.INSERT, transaction: t });
            for (const line of bill.lines) {
                const l = { ...line, invoice_id: invoiceId };
                await db.sequelize.query(`
                    INSERT INTO t_tt_invoice_line (${LINE_COLUMNS.join(', ')})
                    VALUES (${LINE_COLUMNS.map(c => ':' + c).join(', ')})
                `, { replacements: Object.fromEntries(LINE_COLUMNS.map(c => [c, l[c] === undefined ? null : l[c]])),
                    type: QueryTypes.INSERT, transaction: t });
            }
            for (const vehicleNo of new Set(bill.lines.map(l => l.vehicle_no).filter(Boolean))) {
                await db.sequelize.query(`
                    INSERT INTO m_tt_vehicle (location_code, vehicle_no, vendor_id, created_by, updated_by)
                    SELECT :locationCode, :vehicleNo, :vendorId, :by, :by FROM DUAL
                    WHERE NOT EXISTS (SELECT 1 FROM m_tt_vehicle WHERE location_code = :locationCode AND vehicle_no = :vehicleNo)
                `, { replacements: { locationCode, vehicleNo, vendorId: bill.vendor_id, by }, type: QueryTypes.INSERT, transaction: t });
            }
            ids.push(invoiceId);
        }
        return ids;
    }),

    getInvoices: (locationCode, fromDate, toDate) => select(`
        SELECT i.*, v.oil_company, v.vendor_code,
               DATE_FORMAT(i.bill_date, '%Y-%m-%d') AS bill_date_iso,
               e.event_status AS gl_status, e.error_message AS gl_error
        FROM t_tt_invoice i
        JOIN m_tt_vendor v ON v.vendor_id = i.vendor_id
        LEFT JOIN gl_accounting_events e ON e.event_id = (
            SELECT MAX(e2.event_id) FROM gl_accounting_events e2
            WHERE e2.source_type = 'TT_INVOICE' AND e2.source_id = i.invoice_id)
        WHERE i.location_code = :locationCode AND i.bill_date BETWEEN :fromDate AND :toDate
        ORDER BY i.bill_date, i.bill_no
    `, { locationCode, fromDate, toDate }),

    getInvoice: async (locationCode, invoiceId) => {
        const [inv] = await select(`
            SELECT i.*, v.oil_company, v.vendor_code, v.vendor_name
            FROM t_tt_invoice i JOIN m_tt_vendor v ON v.vendor_id = i.vendor_id
            WHERE i.location_code = :locationCode AND i.invoice_id = :invoiceId
        `, { locationCode, invoiceId });
        if (!inv) return null;
        inv.lines = await select(`SELECT * FROM t_tt_invoice_line WHERE invoice_id = :invoiceId ORDER BY sno, line_id`, { invoiceId });
        return inv;
    },

    // Archives the bill, then deletes it. GL: events not yet posted are dropped; a posted
    // voucher is reversed by a DELETE event on the next Create Accounting run.
    deleteInvoice: (locationCode, invoiceId, reason, deletedBy) => db.sequelize.transaction(async (t) => {
        const [inv] = await select(`SELECT * FROM t_tt_invoice WHERE location_code = :locationCode AND invoice_id = :invoiceId FOR UPDATE`,
            { locationCode, invoiceId }, t);
        if (!inv) return false;
        const lines = await select(`SELECT * FROM t_tt_invoice_line WHERE invoice_id = :invoiceId`, { invoiceId }, t);

        await db.sequelize.query(`
            INSERT INTO t_tt_invoice_deleted (invoice_id, location_code, bill_no, bill_date, taxable_value, tds_amount,
                                              net_receivable, invoice_data, delete_reason, deleted_by)
            VALUES (:invoice_id, :location_code, :bill_no, :bill_date, :taxable_value, :tds_amount,
                    :net_receivable, :invoiceData, :reason, :deletedBy)
        `, { replacements: { ...inv, invoiceData: JSON.stringify({ ...inv, lines }), reason, deletedBy },
            type: QueryTypes.INSERT, transaction: t });

        await db.sequelize.query(`
            DELETE FROM gl_accounting_events
            WHERE source_type = 'TT_INVOICE' AND source_id = :invoiceId AND event_status <> 'PROCESSED'
        `, { replacements: { invoiceId }, type: QueryTypes.DELETE, transaction: t });
        const [last] = await select(`
            SELECT location_code, fy_id, event_type, event_date FROM gl_accounting_events
            WHERE source_type = 'TT_INVOICE' AND source_id = :invoiceId
            ORDER BY event_id DESC LIMIT 1
        `, { invoiceId }, t);
        if (last && last.event_type !== 'DELETE') {
            await db.sequelize.query(`
                INSERT INTO gl_accounting_events
                    (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                VALUES (:location_code, :fy_id, 'TT_INVOICE', :invoiceId, 'DELETE', :event_date, 'UNPROCESSED', :deletedBy)
            `, { replacements: { ...last, invoiceId, deletedBy }, type: QueryTypes.INSERT, transaction: t });
        }

        await db.sequelize.query(`DELETE FROM t_tt_invoice WHERE invoice_id = :invoiceId`,
            { replacements: { invoiceId }, type: QueryTypes.DELETE, transaction: t });
        return true;
    }),

    getDeletedInvoices: (locationCode) => select(`
        SELECT d.*, DATE_FORMAT(d.bill_date, '%Y-%m-%d') AS bill_date_iso
        FROM t_tt_invoice_deleted d
        WHERE d.location_code = :locationCode
        ORDER BY d.deleted_date DESC
        LIMIT 200
    `, { locationCode }),

    // ── Statement: what the oil company owes on freight ─────────────────────
    // Bills (net of TDS; GST is paid by the oil company under reverse charge) against the
    // bank credits tagged "TT FREIGHT - <oil company>", whole or split.
    getStatement: (locationCode, vendorId, fromDate, toDate) => select(`
        SELECT * FROM (
            SELECT i.bill_date AS txn_date, 'Bill' AS txn_type,
                   CONCAT('Bill ', i.bill_no, ' · ', i.trip_count, ' trips') AS particulars,
                   i.net_receivable AS debit, 0 AS credit, i.taxable_value AS taxable, i.tds_amount AS tds,
                   i.invoice_id AS ref_id
            FROM t_tt_invoice i
            WHERE i.location_code = :locationCode AND i.vendor_id = :vendorId
              AND i.bill_date BETWEEN :fromDate AND :toDate

            UNION ALL

            SELECT DATE(b.trans_date), 'Bank', CONCAT(mb.bank_name, ' - ', COALESCE(b.remarks, '')),
                   0, b.credit_amount, 0, 0, b.t_bank_id
            FROM t_bank_transaction b
            JOIN m_bank mb ON mb.bank_id = b.bank_id
            JOIN m_tt_vendor v ON v.vendor_id = :vendorId
            WHERE mb.location_code = :locationCode
              AND COALESCE(b.is_split, 'N') <> 'Y'
              AND b.ledger_name = CONCAT('TT FREIGHT - ', v.oil_company)
              AND DATE(b.trans_date) BETWEEN :fromDate AND :toDate

            UNION ALL

            SELECT DATE(b.trans_date), 'Bank', CONCAT(mb.bank_name, ' - ', COALESCE(s.remarks, b.remarks, ''), ' (split)'),
                   0, s.amount, 0, 0, b.t_bank_id
            FROM t_bank_transaction_splits s
            JOIN t_bank_transaction b ON b.t_bank_id = s.t_bank_id
            JOIN m_bank mb ON mb.bank_id = b.bank_id
            JOIN m_tt_vendor v ON v.vendor_id = :vendorId
            WHERE mb.location_code = :locationCode
              AND s.ledger_name = CONCAT('TT FREIGHT - ', v.oil_company)
              AND DATE(b.trans_date) BETWEEN :fromDate AND :toDate
        ) x
        ORDER BY txn_date, txn_type = 'Bank', ref_id
    `, { locationCode, vendorId, fromDate, toDate }),

    getOpeningBalance: async (locationCode, vendorId, beforeDate) => {
        const [row] = await select(`
            SELECT
              (SELECT COALESCE(SUM(i.net_receivable), 0) FROM t_tt_invoice i
               WHERE i.location_code = :locationCode AND i.vendor_id = :vendorId AND i.bill_date < :beforeDate)
            - (SELECT COALESCE(SUM(b.credit_amount), 0) FROM t_bank_transaction b
               JOIN m_bank mb ON mb.bank_id = b.bank_id
               JOIN m_tt_vendor v ON v.vendor_id = :vendorId
               WHERE mb.location_code = :locationCode AND COALESCE(b.is_split, 'N') <> 'Y'
                 AND b.ledger_name = CONCAT('TT FREIGHT - ', v.oil_company) AND DATE(b.trans_date) < :beforeDate)
            - (SELECT COALESCE(SUM(s.amount), 0) FROM t_bank_transaction_splits s
               JOIN t_bank_transaction b ON b.t_bank_id = s.t_bank_id
               JOIN m_bank mb ON mb.bank_id = b.bank_id
               JOIN m_tt_vendor v ON v.vendor_id = :vendorId
               WHERE mb.location_code = :locationCode
                 AND s.ledger_name = CONCAT('TT FREIGHT - ', v.oil_company) AND DATE(b.trans_date) < :beforeDate)
            AS opening
        `, { locationCode, vendorId, beforeDate });
        return Number(row.opening || 0);
    },

    // Bank credits from the start date that are still tagged to a label posting straight to the
    // freight income ledger (the old way, e.g. "TANK TRUCK RENT RECEIVED"). Once bills post the
    // income, these would count it twice; they should be retagged "TT FREIGHT - <oil company>".
    getReceiptsOnIncomeLabels: (locationCode, vendorId) => select(`
        SELECT * FROM (
            SELECT b.t_bank_id, DATE_FORMAT(b.trans_date, '%Y-%m-%d') AS trans_date, mb.bank_name, mb.account_number,
                   b.ledger_name AS label, b.credit_amount AS amount, b.remarks
            FROM t_bank_transaction b
            JOIN m_bank mb ON mb.bank_id = b.bank_id
            JOIN m_tt_vendor v ON v.vendor_id = :vendorId
            JOIN gl_static_ledger_map m ON m.location_code = mb.location_code AND m.ledger_name = b.ledger_name
            WHERE mb.location_code = :locationCode AND COALESCE(b.is_split, 'N') <> 'Y'
              AND m.gl_ledger_id = v.income_ledger_id AND b.credit_amount > 0
              AND DATE(b.trans_date) >= v.start_date
            UNION ALL
            SELECT b.t_bank_id, DATE_FORMAT(b.trans_date, '%Y-%m-%d'), mb.bank_name, mb.account_number,
                   s.ledger_name, s.amount, COALESCE(s.remarks, b.remarks)
            FROM t_bank_transaction_splits s
            JOIN t_bank_transaction b ON b.t_bank_id = s.t_bank_id
            JOIN m_bank mb ON mb.bank_id = b.bank_id
            JOIN m_tt_vendor v ON v.vendor_id = :vendorId
            JOIN gl_static_ledger_map m ON m.location_code = mb.location_code AND m.ledger_name = s.ledger_name
            WHERE mb.location_code = :locationCode
              AND m.gl_ledger_id = v.income_ledger_id AND COALESCE(b.credit_amount, 0) > 0
              AND DATE(b.trans_date) >= v.start_date
        ) x
        ORDER BY trans_date
    `, { locationCode, vendorId }),

    // ── GST: freight bills of a period (GSTR-1 b2b, reverse charge) ─────────
    getGstInvoices: (locationCode, fromDate, toDate) => select(`
        SELECT i.bill_no, i.bill_date, i.recipient_name, i.recipient_gstin, i.reverse_charge, i.sac_code, i.gst_rate,
               i.taxable_value, i.cgst_amount, i.sgst_amount, i.igst_amount, i.invoice_value, i.trip_count, i.vehicles
        FROM t_tt_invoice i
        WHERE i.location_code = :locationCode AND i.bill_date BETWEEN :fromDate AND :toDate
        ORDER BY i.bill_date, i.bill_no
    `, { locationCode, fromDate, toDate }),
};

// One credit rule "TT FREIGHT - <oil company>" on the vendor's receipt bank, mapped in
// gl_static_ledger_map to the vendor's debtor ledger, so a credit tagged on the bank
// statement posts Bank Dr / Debtor Cr. A rule on another bank is dropped.
async function syncReceiptRule(locationCode, vendorId, by, t) {
    const [v] = await select(`SELECT * FROM m_tt_vendor WHERE vendor_id = :vendorId`, { vendorId }, t);
    if (!v) return;
    const label = receiptLabel(v.oil_company);
    await db.sequelize.query(`
        DELETE FROM m_ledger_rules
        WHERE location_code = :locationCode AND source_type = 'Static' AND ledger_name = :label
          AND (bank_id <> :bankId OR :bankId = 0)
    `, { replacements: { locationCode, label, bankId: v.receipt_bank_id || 0 }, type: QueryTypes.DELETE, transaction: t });
    if (v.receipt_bank_id) {
        await db.sequelize.query(`
            INSERT INTO m_ledger_rules
                (location_code, bank_id, source_type, external_id, ledger_name, allowed_entry_type,
                 notes_required_flag, allow_split_flag, created_by, updated_by, effective_start_date)
            SELECT :locationCode, :bankId, 'Static', NULL, :label, 'CREDIT', 'N', 'Y', :by, :by, :startDate
            FROM DUAL
            WHERE NOT EXISTS (SELECT 1 FROM m_ledger_rules
                              WHERE location_code = :locationCode AND bank_id = :bankId
                                AND source_type = 'Static' AND ledger_name = :label)
        `, { replacements: { locationCode, bankId: v.receipt_bank_id, label, by, startDate: v.start_date },
            type: QueryTypes.INSERT, transaction: t });
    }
    if (v.debtor_ledger_id) {
        await db.sequelize.query(`
            INSERT INTO gl_static_ledger_map (location_code, ledger_name, treatment, gl_ledger_id, created_by, updated_by)
            VALUES (:locationCode, :label, 'POST', :ledgerId, :by, :by)
            ON DUPLICATE KEY UPDATE treatment = 'POST', gl_ledger_id = VALUES(gl_ledger_id), updated_by = VALUES(updated_by)
        `, { replacements: { locationCode, label, ledgerId: v.debtor_ledger_id, by }, type: QueryTypes.INSERT, transaction: t });
    }
}

module.exports = TtDao;
