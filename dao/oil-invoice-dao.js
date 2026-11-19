// dao/oil-invoice-dao.js — IOCL charge invoices register (tkt #484): t_oil_co_invoice(_line),
// m_oil_charge_type, linked to the SAP debits on the oil company account (t_bank_transaction).
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

const select = (sql, replacements, transaction) =>
    db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

const DOC_ENTITY = 'OIL_CO_INVOICE';

const INVOICE_COLUMNS = [
    'location_code', 'oil_company', 'charge_code', 'invoice_no', 'sap_ref', 'invoice_date', 'description', 'sac_code',
    'supplier_gstin', 'recipient_gstin', 'recipient_name', 'taxable_value', 'cgst_amount', 'sgst_amount', 'igst_amount',
    'cess_amount', 'total_amount', 'total_kl', 'file_name', 'created_by', 'updated_by'
];
const LINE_COLUMNS = [
    'invoice_id', 'sno', 'delivery_no', 'delivery_date', 'purchase_invoice_no', 'purchase_invoice_date', 'product',
    'qty_kl', 'rate_per_kl', 'net_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'line_amount'
];

const OilInvoiceDao = {
    DOC_ENTITY,

    getChargeTypes: () => select(`
        SELECT charge_code, oil_company, charge_name, sap_pattern, invoice_pattern, sac_code, match_by, notes
        FROM m_oil_charge_type WHERE active_flag = 'Y' ORDER BY sort_order, charge_code
    `),

    // The location's IOCL SAP account (oil company "bank" whose supplier is Indian Oil).
    getIoclAccount: async (locationCode) => {
        const [b] = await select(`
            SELECT b.bank_id, b.bank_name, b.account_number, b.supplier_id, s.supplier_name
            FROM m_bank b
            JOIN m_supplier s ON s.supplier_id = b.supplier_id
            WHERE b.location_code = :locationCode AND b.is_oil_company = 'Y' AND b.active_flag = 'Y'
              AND REPLACE(UPPER(s.supplier_name), ' ', '') LIKE '%INDIANOIL%'
            ORDER BY b.bank_id
            LIMIT 1
        `, { locationCode });
        return b || null;
    },

    getExistingInvoiceNos: async (locationCode, invoiceNos) => {
        if (!invoiceNos.length) return new Map();
        const rows = await select(`
            SELECT invoice_no, invoice_id FROM t_oil_co_invoice
            WHERE location_code = :locationCode AND invoice_no IN (:invoiceNos)
        `, { locationCode, invoiceNos });
        return new Map(rows.map(r => [r.invoice_no, r.invoice_id]));
    },

    // Saves one invoice, its LFR rows and the PDF. Returns invoice_id.
    createInvoice: (inv, lines, pdf) => db.sequelize.transaction(async (t) => {
        const [invoiceId] = await db.sequelize.query(`
            INSERT INTO t_oil_co_invoice (${INVOICE_COLUMNS.join(', ')})
            VALUES (${INVOICE_COLUMNS.map(c => ':' + c).join(', ')})
        `, { replacements: Object.fromEntries(INVOICE_COLUMNS.map(c => [c, inv[c] === undefined ? null : inv[c]])),
             type: QueryTypes.INSERT, transaction: t });
        for (const l of lines) {
            const row = { ...l, invoice_id: invoiceId };
            await db.sequelize.query(`
                INSERT INTO t_oil_co_invoice_line (${LINE_COLUMNS.join(', ')})
                VALUES (${LINE_COLUMNS.map(c => ':' + c).join(', ')})
            `, { replacements: Object.fromEntries(LINE_COLUMNS.map(c => [c, row[c] === undefined ? null : row[c]])),
                 type: QueryTypes.INSERT, transaction: t });
        }
        if (pdf) {
            const doc = await db.document_store.create({
                entity_type: DOC_ENTITY, entity_id: invoiceId, doc_category: 'INVOICE',
                file_name: pdf.file_name, mime_type: 'application/pdf', file_size: pdf.buffer.length, file_data: pdf.buffer,
                location_code: inv.location_code, created_by: inv.created_by, creation_date: new Date()
            }, { transaction: t });
            await db.sequelize.query(`UPDATE t_oil_co_invoice SET doc_id = :docId WHERE invoice_id = :invoiceId`,
                { replacements: { docId: doc.doc_id, invoiceId }, transaction: t });
        }
        return invoiceId;
    }),

    getInvoices: (locationCode, fromDate, toDate) => select(`
        SELECT i.*, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS invoice_date_iso,
               ct.charge_name, ct.match_by,
               tb.trans_date AS sap_date, tb.debit_amount AS sap_amount, tb.remarks AS sap_remarks,
               (SELECT COUNT(*) FROM t_oil_co_invoice_line l WHERE l.invoice_id = i.invoice_id) AS line_count
        FROM t_oil_co_invoice i
        LEFT JOIN m_oil_charge_type ct ON ct.charge_code = i.charge_code
        LEFT JOIN t_bank_transaction tb ON tb.t_bank_id = i.t_bank_id
        WHERE i.location_code = :locationCode AND i.invoice_date BETWEEN :fromDate AND :toDate
        ORDER BY i.invoice_date DESC, i.invoice_id DESC
    `, { locationCode, fromDate, toDate }),

    getInvoice: async (locationCode, invoiceId) => {
        const [inv] = await select(`
            SELECT i.*, ct.charge_name, tb.trans_date AS sap_date, tb.debit_amount AS sap_amount, tb.remarks AS sap_remarks
            FROM t_oil_co_invoice i
            LEFT JOIN m_oil_charge_type ct ON ct.charge_code = i.charge_code
            LEFT JOIN t_bank_transaction tb ON tb.t_bank_id = i.t_bank_id
            WHERE i.location_code = :locationCode AND i.invoice_id = :invoiceId
        `, { locationCode, invoiceId });
        if (!inv) return null;
        inv.lines = await select(`SELECT * FROM t_oil_co_invoice_line WHERE invoice_id = :invoiceId ORDER BY sno`, { invoiceId });
        return inv;
    },

    // The PDF of an invoice of this location (metadata + data).
    getInvoicePdf: async (locationCode, invoiceId) => {
        const [row] = await select(`
            SELECT d.doc_id FROM t_oil_co_invoice i
            JOIN t_document_store d ON d.doc_id = i.doc_id AND d.entity_type = :entity
            WHERE i.location_code = :locationCode AND i.invoice_id = :invoiceId
        `, { locationCode, invoiceId, entity: DOC_ENTITY });
        return row ? db.document_store.findOne({ where: { doc_id: row.doc_id } }) : null;
    },

    deleteInvoice: (locationCode, invoiceId) => db.sequelize.transaction(async (t) => {
        const [inv] = await select(`SELECT invoice_id, doc_id FROM t_oil_co_invoice WHERE location_code = :locationCode AND invoice_id = :invoiceId FOR UPDATE`,
            { locationCode, invoiceId }, t);
        if (!inv) return false;
        await db.sequelize.query(`DELETE FROM t_oil_co_invoice WHERE invoice_id = :invoiceId`, { replacements: { invoiceId }, transaction: t });
        if (inv.doc_id) {
            await db.sequelize.query(`DELETE FROM t_document_store WHERE doc_id = :docId AND entity_type = :entity`,
                { replacements: { docId: inv.doc_id, entity: DOC_ENTITY }, transaction: t });
        }
        return true;
    }),

    // ── Linking to SAP debits ────────────────────────────────────────────────
    getUnlinkedInvoices: (locationCode) => select(`
        SELECT i.invoice_id, i.charge_code, i.invoice_no, i.sap_ref, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS invoice_date,
               i.total_amount, ct.sap_pattern, ct.match_by
        FROM t_oil_co_invoice i
        JOIN m_oil_charge_type ct ON ct.charge_code = i.charge_code
        WHERE i.location_code = :locationCode AND i.t_bank_id IS NULL AND ct.match_by <> 'NONE'
          AND COALESCE(i.match_method, '') <> 'UNLINKED'
        ORDER BY i.invoice_date, i.invoice_id
    `, { locationCode }),

    // SAP debit whose narration carries the SAP invoice number (LFR).
    findSapDebitByRef: async (bankId, sapRef) => {
        const [r] = await select(`
            SELECT tb.t_bank_id FROM t_bank_transaction tb
            WHERE tb.bank_id = :bankId AND tb.debit_amount > 0 AND tb.remarks LIKE :ref
              AND NOT EXISTS (SELECT 1 FROM t_oil_co_invoice i WHERE i.t_bank_id = tb.t_bank_id)
            ORDER BY tb.trans_date LIMIT 1
        `, { bankId, ref: `%${sapRef}%` });
        return r ? r.t_bank_id : null;
    },

    // Free SAP debit of this amount from daysBefore to daysAfter around the invoice date,
    // nearest first. A charge pattern narrows it to that kind of charge; without one (OTHER)
    // any non-product debit counts.
    findSapDebitByAmount: async (bankId, amount, invoiceDate, sapPattern, daysBefore, daysAfter) => {
        const [r] = await select(`
            SELECT tb.t_bank_id FROM t_bank_transaction tb
            WHERE tb.bank_id = :bankId
              AND ABS(tb.debit_amount - :amount) < 0.01
              AND DATE(tb.trans_date) BETWEEN DATE_SUB(:invoiceDate, INTERVAL :daysBefore DAY) AND DATE_ADD(:invoiceDate, INTERVAL :daysAfter DAY)
              AND ${sapPattern ? 'tb.remarks REGEXP :sapPattern' : "COALESCE(tb.remarks, '') NOT REGEXP 'INVOICE|PRODUCT SUPPLY'"}
              AND NOT EXISTS (SELECT 1 FROM t_oil_co_invoice i WHERE i.t_bank_id = tb.t_bank_id)
            ORDER BY ABS(DATEDIFF(DATE(tb.trans_date), :invoiceDate)), tb.t_bank_id
            LIMIT 1
        `, { bankId, amount, invoiceDate, sapPattern: sapPattern || '', daysBefore, daysAfter });
        return r ? r.t_bank_id : null;
    },

    linkSapDebit: async (invoiceId, tBankId, method, by) => {
        try {
            const [, meta] = await db.sequelize.query(`
                UPDATE t_oil_co_invoice SET t_bank_id = :tBankId, match_method = :method, updated_by = :by
                WHERE invoice_id = :invoiceId AND t_bank_id IS NULL
            `, { replacements: { invoiceId, tBankId, method, by } });
            return !!(meta && meta.affectedRows);
        } catch (e) {
            if (e.parent && e.parent.code === 'ER_DUP_ENTRY') return false; // linked to another invoice a moment ago
            throw e;
        }
    },

    // keepOff: unlinked by hand (match_method UNLINKED) — automatic linking leaves it alone
    unlinkSapDebit: async (locationCode, invoiceId, by, keepOff) => {
        const [, meta] = await db.sequelize.query(`
            UPDATE t_oil_co_invoice SET t_bank_id = NULL, match_method = :method, updated_by = :by
            WHERE location_code = :locationCode AND invoice_id = :invoiceId
        `, { replacements: { locationCode, invoiceId, by, method: keepOff ? 'UNLINKED' : null } });
        return !!(meta && meta.affectedRows);
    },

    // SAP debits that look like a charge (any active pattern), with the invoice linked to each.
    getSapCharges: (bankId, fromDate, toDate, combinedPattern) => select(`
        SELECT tb.t_bank_id, DATE_FORMAT(tb.trans_date, '%Y-%m-%d') AS trans_date, tb.debit_amount, tb.remarks, tb.ledger_name,
               i.invoice_id, i.invoice_no, i.invoice_date, i.charge_code AS invoice_charge_code, i.match_method
        FROM t_bank_transaction tb
        LEFT JOIN t_oil_co_invoice i ON i.t_bank_id = tb.t_bank_id
        WHERE tb.bank_id = :bankId AND tb.debit_amount > 0
          AND DATE(tb.trans_date) BETWEEN :fromDate AND :toDate
          AND (tb.remarks REGEXP :combinedPattern OR i.invoice_id IS NOT NULL)
        ORDER BY tb.trans_date DESC, tb.t_bank_id DESC
    `, { bankId, fromDate, toDate, combinedPattern }),

    // Free SAP debits that could be this invoice (for linking by hand): same amount, any date.
    getLinkCandidates: (bankId, amount) => select(`
        SELECT tb.t_bank_id, DATE_FORMAT(tb.trans_date, '%Y-%m-%d') AS trans_date, tb.debit_amount, tb.remarks
        FROM t_bank_transaction tb
        WHERE tb.bank_id = :bankId AND ABS(tb.debit_amount - :amount) < 0.01
          AND NOT EXISTS (SELECT 1 FROM t_oil_co_invoice i WHERE i.t_bank_id = tb.t_bank_id)
        ORDER BY tb.trans_date DESC LIMIT 20
    `, { bankId, amount }),

    getSapDebit: async (bankId, tBankId) => {
        const [r] = await select(`
            SELECT tb.t_bank_id, tb.debit_amount FROM t_bank_transaction tb
            WHERE tb.bank_id = :bankId AND tb.t_bank_id = :tBankId AND tb.debit_amount > 0
        `, { bankId, tBankId });
        return r || null;
    },

    // ── LFR check ────────────────────────────────────────────────────────────
    // One row per (LFR invoice, fuel invoice charged on it), with the fuel invoice in Tank Receipts.
    getLfrPurchaseCheck: (locationCode, fromDate, toDate) => select(`
        SELECT i.invoice_id, i.invoice_no, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS lfr_date,
               l.purchase_invoice_no, MIN(l.purchase_invoice_date) AS purchase_invoice_date,
               MIN(l.delivery_no) AS delivery_no,
               GROUP_CONCAT(DISTINCT l.product ORDER BY l.product SEPARATOR ', ') AS products,
               SUM(l.qty_kl) AS lfr_kl, SUM(l.line_amount) AS lfr_amount,
               (SELECT MIN(ti.id) FROM t_tank_invoice ti
                 WHERE ti.location_id = i.location_code AND ti.invoice_number = l.purchase_invoice_no) AS tank_invoice_id
        FROM t_oil_co_invoice i
        JOIN t_oil_co_invoice_line l ON l.invoice_id = i.invoice_id
        WHERE i.location_code = :locationCode AND i.charge_code = 'LFR'
          AND i.invoice_date BETWEEN :fromDate AND :toDate
        GROUP BY i.invoice_id, i.invoice_no, i.invoice_date, l.purchase_invoice_no
        ORDER BY i.invoice_date DESC, MIN(l.sno)
    `, { locationCode, fromDate, toDate }),

    getTankInvoicesByIds: (ids) => ids.length ? select(`
        SELECT ti.id, DATE_FORMAT(ti.invoice_date, '%Y-%m-%d') AS invoice_date, ti.invoice_number, ti.total_invoice_amount,
               (SELECT SUM(d.quantity) FROM t_tank_invoice_dtl d WHERE d.invoice_id = ti.id) AS kl,
               (SELECT GROUP_CONCAT(d.product_name ORDER BY d.product_name SEPARATOR ', ') FROM t_tank_invoice_dtl d WHERE d.invoice_id = ti.id) AS products
        FROM t_tank_invoice ti WHERE ti.id IN (:ids)
    `, { ids }) : Promise.resolve([]),

    // IOCL fuel invoices in Tank Receipts dated in a period, with whether any LFR invoice lists them.
    getTankInvoicesInPeriod: (locationCode, supplierId, fromDate, toDate) => select(`
        SELECT ti.id, DATE_FORMAT(ti.invoice_date, '%Y-%m-%d') AS invoice_date, ti.invoice_number, ti.total_invoice_amount,
               (SELECT SUM(d.quantity) FROM t_tank_invoice_dtl d WHERE d.invoice_id = ti.id) AS kl,
               (SELECT GROUP_CONCAT(d.product_name ORDER BY d.product_name SEPARATOR ', ') FROM t_tank_invoice_dtl d WHERE d.invoice_id = ti.id) AS products,
               EXISTS (SELECT 1 FROM t_oil_co_invoice_line l JOIN t_oil_co_invoice i ON i.invoice_id = l.invoice_id
                       WHERE i.location_code = ti.location_id AND i.charge_code = 'LFR' AND l.purchase_invoice_no = ti.invoice_number) AS on_lfr
        FROM t_tank_invoice ti
        WHERE ti.location_id = :locationCode AND ti.supplier_id = :supplierId
          AND ti.invoice_date BETWEEN :fromDate AND :toDate
        ORDER BY ti.invoice_date, ti.invoice_number
    `, { locationCode, supplierId, fromDate, toDate }),
};

module.exports = OilInvoiceDao;
