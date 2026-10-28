// dao/rental-dao.js — rental invoices (/rental): settings, tenant master, invoices
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

const select = (sql, replacements, transaction) =>
    db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// Label for the bank-reconciliation Static rule that tags a rent receipt to a tenant
const receiptLabel = (tenantName) => `RENT - ${tenantName}`;

const TENANT_COLUMNS = [
    'tenant_name', 'tenant_address', 'city', 'pincode', 'gstin', 'phone', 'email', 'property_address',
    'rent_description', 'sac_code', 'monthly_rent', 'gst_rate', 'tds_percent',
    'start_date', 'end_date', 'notes'
];

const SETTINGS_COLUMNS = [
    'landlord_name', 'landlord_address', 'landlord_city', 'landlord_pincode', 'gstin', 'pan', 'bank_name', 'bank_branch',
    'bank_ifsc', 'bank_account_no', 'rent_bank_id', 'last_invoice_no', 'invoice_day'
];

const RentalDao = {
    receiptLabel,

    // ── Settings ────────────────────────────────────────────────────────────
    getSettings: async (locationCode, transaction) => {
        const rows = await select(`
            SELECT s.*, b.bank_name AS rent_bank_name, b.account_number AS rent_bank_account
            FROM m_rental_settings s
            LEFT JOIN m_bank b ON b.bank_id = s.rent_bank_id
            WHERE s.location_code = :locationCode
        `, { locationCode }, transaction);
        return rows[0] || null;
    },

    saveSettings: async (locationCode, data, updatedBy) => {
        const sets = SETTINGS_COLUMNS.map(c => `${c} = :${c}`).join(', ');
        await db.sequelize.query(`
            UPDATE m_rental_settings SET ${sets}, updated_by = :updatedBy
            WHERE location_code = :locationCode
        `, { replacements: { ...data, locationCode, updatedBy }, type: QueryTypes.UPDATE });
    },

    getBanks: (locationCode) => select(`
        SELECT bank_id, bank_name, account_number, account_nickname
        FROM m_bank
        WHERE location_code = :locationCode AND active_flag = 'Y' AND COALESCE(is_oil_company, 'N') <> 'Y'
        ORDER BY bank_name, account_number
    `, { locationCode }),

    // ── Tenants ─────────────────────────────────────────────────────────────
    getTenants: (locationCode) => select(`
        SELECT t.*, l.ledger_name,
               (SELECT COUNT(*) FROM t_rental_invoice i WHERE i.tenant_id = t.tenant_id) AS invoice_count
        FROM m_rental_tenant t
        LEFT JOIN gl_ledgers l ON l.ledger_id = t.ledger_id
        WHERE t.location_code = :locationCode
        ORDER BY (t.end_date IS NOT NULL AND t.end_date < CURDATE()), t.tenant_name
    `, { locationCode }),

    getTenant: async (locationCode, tenantId, transaction) => {
        const rows = await select(`
            SELECT * FROM m_rental_tenant WHERE location_code = :locationCode AND tenant_id = :tenantId
        `, { locationCode, tenantId }, transaction);
        return rows[0] || null;
    },

    tenantNameExists: async (locationCode, tenantName, exceptTenantId) => {
        const rows = await select(`
            SELECT 1 FROM m_rental_tenant
            WHERE location_code = :locationCode AND tenant_name = :tenantName AND tenant_id <> :exceptTenantId
        `, { locationCode, tenantName, exceptTenantId: exceptTenantId || 0 });
        return rows.length > 0;
    },

    // Creates the tenant and its GL ledger (Sundry Debtors). If a Sundry Debtors
    // ledger of the same name already exists (the tenant also buys fuel on credit),
    // the tenant shares it, so Tally keeps one party ledger.
    createTenant: async (locationCode, data, createdBy) => {
        return db.sequelize.transaction(async (t) => {
            const cols = TENANT_COLUMNS.join(', ');
            const vals = TENANT_COLUMNS.map(c => `:${c}`).join(', ');
            const [tenantId] = await db.sequelize.query(`
                INSERT INTO m_rental_tenant (location_code, ${cols}, created_by, updated_by)
                VALUES (:locationCode, ${vals}, :createdBy, :createdBy)
            `, { replacements: { ...data, locationCode, createdBy }, type: QueryTypes.INSERT, transaction: t });

            const ledgerId = await ensureTenantLedger(locationCode, tenantId, data.tenant_name, createdBy, t);
            await db.sequelize.query(`UPDATE m_rental_tenant SET ledger_id = :ledgerId WHERE tenant_id = :tenantId`,
                { replacements: { ledgerId, tenantId }, type: QueryTypes.UPDATE, transaction: t });

            await syncReceiptRules(locationCode, createdBy, t);
            return tenantId;
        });
    },

    // The tenant name is not changed here once invoices exist (the ledger and the
    // bank receipt label carry it); the controller enforces that.
    updateTenant: async (locationCode, tenantId, data, updatedBy) => {
        return db.sequelize.transaction(async (t) => {
            const sets = TENANT_COLUMNS.map(c => `${c} = :${c}`).join(', ');
            await db.sequelize.query(`
                UPDATE m_rental_tenant SET ${sets}, updated_by = :updatedBy
                WHERE location_code = :locationCode AND tenant_id = :tenantId
            `, { replacements: { ...data, locationCode, tenantId, updatedBy }, type: QueryTypes.UPDATE, transaction: t });

            // Rename the tenant's own ledger (not one shared with a credit customer)
            await db.sequelize.query(`
                UPDATE gl_ledgers l
                JOIN m_rental_tenant tn ON tn.ledger_id = l.ledger_id
                SET l.ledger_name = tn.tenant_name, l.updated_by = :updatedBy
                WHERE tn.tenant_id = :tenantId AND l.source_type = 'TENANT' AND l.source_id = tn.tenant_id
                  AND NOT EXISTS (SELECT 1 FROM (SELECT ledger_id, ledger_name, location_code FROM gl_ledgers) x
                                  WHERE x.location_code = l.location_code AND x.ledger_name = tn.tenant_name
                                    AND x.ledger_id <> l.ledger_id)
            `, { replacements: { tenantId, updatedBy }, type: QueryTypes.UPDATE, transaction: t });

            await syncReceiptRules(locationCode, updatedBy, t);
        });
    },

    deleteTenant: async (locationCode, tenantId) => {
        return db.sequelize.transaction(async (t) => {
            const [tenant] = await select(`SELECT * FROM m_rental_tenant WHERE location_code = :locationCode AND tenant_id = :tenantId`,
                { locationCode, tenantId }, t);
            if (!tenant) return;
            const label = receiptLabel(tenant.tenant_name);
            await db.sequelize.query(`DELETE FROM m_ledger_rules WHERE location_code = :locationCode AND source_type = 'Static' AND ledger_name = :label`,
                { replacements: { locationCode, label }, type: QueryTypes.DELETE, transaction: t });
            await db.sequelize.query(`DELETE FROM gl_static_ledger_map WHERE location_code = :locationCode AND ledger_name = :label`,
                { replacements: { locationCode, label }, type: QueryTypes.DELETE, transaction: t });
            await db.sequelize.query(`DELETE FROM m_rental_tenant WHERE tenant_id = :tenantId`,
                { replacements: { tenantId }, type: QueryTypes.DELETE, transaction: t });
            // The tenant's own ledger goes too, unless something was posted to it
            await db.sequelize.query(`
                DELETE FROM gl_ledgers
                WHERE ledger_id = :ledgerId AND source_type = 'TENANT' AND source_id = :tenantId
                  AND NOT EXISTS (SELECT 1 FROM gl_journal_lines jl WHERE jl.ledger_id = :ledgerId)
            `, { replacements: { ledgerId: tenant.ledger_id || 0, tenantId }, type: QueryTypes.DELETE, transaction: t });
        });
    },

    syncReceiptRules: (locationCode, by) => db.sequelize.transaction(t => syncReceiptRules(locationCode, by, t)),

    // ── Invoices ────────────────────────────────────────────────────────────
    getInvoicesForMonth: (locationCode, periodMonth) => select(`
        SELECT i.*, COALESCE(i.tenant_name, t.tenant_name) AS display_name,
               DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS invoice_date_iso,
               e.event_status AS gl_status
        FROM t_rental_invoice i
        JOIN m_rental_tenant t ON t.tenant_id = i.tenant_id
        LEFT JOIN gl_accounting_events e ON e.event_id = (
            SELECT MAX(e2.event_id) FROM gl_accounting_events e2
            WHERE e2.source_type = 'RENTAL_INVOICE' AND e2.source_id = i.invoice_id)
        WHERE i.location_code = :locationCode AND i.period_month = :periodMonth
        ORDER BY i.status = 'CANCELLED', i.invoice_no IS NULL, i.invoice_no, display_name
    `, { locationCode, periodMonth }),

    getInvoice: async (locationCode, invoiceId, transaction) => {
        const rows = await select(`
            SELECT i.*, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS invoice_date_iso,
                   DATE_FORMAT(i.period_month, '%Y-%m-%d') AS period_month_iso
            FROM t_rental_invoice i
            WHERE i.location_code = :locationCode AND i.invoice_id = :invoiceId
        `, { locationCode, invoiceId }, transaction);
        return rows[0] || null;
    },

    // Tenants active on the rent month who have no live (draft/final) invoice for it yet
    getTenantsDueForMonth: (locationCode, periodMonth) => select(`
        SELECT t.* FROM m_rental_tenant t
        WHERE t.location_code = :locationCode
          AND t.start_date <= LAST_DAY(:periodMonth)
          AND (t.end_date IS NULL OR t.end_date >= :periodMonth)
          AND NOT EXISTS (
              SELECT 1 FROM t_rental_invoice i
              WHERE i.tenant_id = t.tenant_id AND i.period_month = :periodMonth AND i.status <> 'CANCELLED')
        ORDER BY t.tenant_name
    `, { locationCode, periodMonth }),

    hasLiveInvoice: async (tenantId, periodMonth, exceptInvoiceId) => {
        const rows = await select(`
            SELECT 1 FROM t_rental_invoice
            WHERE tenant_id = :tenantId AND period_month = :periodMonth AND status <> 'CANCELLED'
              AND invoice_id <> :exceptInvoiceId
        `, { tenantId, periodMonth, exceptInvoiceId: exceptInvoiceId || 0 });
        return rows.length > 0;
    },

    insertDraft: async (locationCode, inv, createdBy) => {
        const [id] = await db.sequelize.query(`
            INSERT INTO t_rental_invoice
                (location_code, tenant_id, invoice_date, period_month, description, sac_code,
                 taxable_value, cgst_rate, sgst_rate, cgst_amount, sgst_amount, total_amount, tds_amount,
                 status, created_by, updated_by)
            VALUES
                (:locationCode, :tenant_id, :invoice_date, :period_month, :description, :sac_code,
                 :taxable_value, :cgst_rate, :sgst_rate, :cgst_amount, :sgst_amount, :total_amount, :tds_amount,
                 'DRAFT', :createdBy, :createdBy)
        `, { replacements: { ...inv, locationCode, createdBy }, type: QueryTypes.INSERT });
        return id;
    },

    updateDraft: async (locationCode, invoiceId, inv, updatedBy) => {
        const [, affected] = await db.sequelize.query(`
            UPDATE t_rental_invoice
            SET invoice_date = :invoice_date, description = :description, sac_code = :sac_code,
                taxable_value = :taxable_value, cgst_rate = :cgst_rate, sgst_rate = :sgst_rate,
                cgst_amount = :cgst_amount, sgst_amount = :sgst_amount, total_amount = :total_amount,
                tds_amount = :tds_amount, updated_by = :updatedBy
            WHERE location_code = :locationCode AND invoice_id = :invoiceId AND status = 'DRAFT'
        `, { replacements: { ...inv, locationCode, invoiceId, updatedBy }, type: QueryTypes.UPDATE });
        return affected;
    },

    deleteDraft: async (locationCode, invoiceId) => {
        await db.sequelize.query(`
            DELETE FROM t_rental_invoice WHERE location_code = :locationCode AND invoice_id = :invoiceId AND status = 'DRAFT'
        `, { replacements: { locationCode, invoiceId }, type: QueryTypes.DELETE });
    },

    // Gives each draft the next running number (in the order given) and copies the
    // tenant's details onto it. The settings row is locked so two users finalising
    // at once can't take the same number.
    finalizeDrafts: async (locationCode, invoiceIds, finalizedBy) => {
        return db.sequelize.transaction(async (t) => {
            const [settings] = await select(`SELECT last_invoice_no FROM m_rental_settings WHERE location_code = :locationCode FOR UPDATE`,
                { locationCode }, t);
            if (!settings) throw new Error('Rental settings are not set up for this location.');
            let nextNo = Number(settings.last_invoice_no);

            const drafts = await select(`
                SELECT i.invoice_id FROM t_rental_invoice i
                JOIN m_rental_tenant tn ON tn.tenant_id = i.tenant_id
                WHERE i.location_code = :locationCode AND i.invoice_id IN (:invoiceIds) AND i.status = 'DRAFT'
                ORDER BY i.invoice_date, tn.tenant_name
            `, { locationCode, invoiceIds }, t);

            for (const d of drafts) {
                nextNo += 1;
                await db.sequelize.query(`
                    UPDATE t_rental_invoice i
                    JOIN m_rental_tenant tn ON tn.tenant_id = i.tenant_id
                    SET i.invoice_no = :invoiceNo, i.status = 'FINAL',
                        i.tenant_name = tn.tenant_name, i.tenant_address = tn.tenant_address,
                        i.tenant_gstin = tn.gstin, i.property_address = tn.property_address,
                        i.tenant_city = tn.city, i.tenant_pincode = tn.pincode,
                        i.finalized_by = :finalizedBy, i.finalized_date = NOW(), i.updated_by = :finalizedBy
                    WHERE i.invoice_id = :invoiceId
                `, { replacements: { invoiceNo: nextNo, finalizedBy, invoiceId: d.invoice_id }, type: QueryTypes.UPDATE, transaction: t });
            }

            await db.sequelize.query(`UPDATE m_rental_settings SET last_invoice_no = :nextNo, updated_by = :finalizedBy WHERE location_code = :locationCode`,
                { replacements: { nextNo, finalizedBy, locationCode }, type: QueryTypes.UPDATE, transaction: t });
            return drafts.length;
        });
    },

    // Cancels a final invoice. If it was already picked up by GL (any event exists),
    // a DELETE event reverses its voucher on the next Create Accounting run.
    cancelInvoice: async (locationCode, invoiceId, reason, cancelledBy) => {
        return db.sequelize.transaction(async (t) => {
            const [, affected] = await db.sequelize.query(`
                UPDATE t_rental_invoice
                SET status = 'CANCELLED', cancel_reason = :reason, cancelled_by = :cancelledBy,
                    cancelled_date = NOW(), updated_by = :cancelledBy
                WHERE location_code = :locationCode AND invoice_id = :invoiceId AND status = 'FINAL'
            `, { replacements: { locationCode, invoiceId, reason, cancelledBy }, type: QueryTypes.UPDATE, transaction: t });
            if (!affected) return false;

            await db.sequelize.query(`
                INSERT INTO gl_accounting_events
                    (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                SELECT e.location_code, e.fy_id, 'RENTAL_INVOICE', e.source_id, 'DELETE', e.event_date, 'UNPROCESSED', :cancelledBy
                FROM gl_accounting_events e
                WHERE e.source_type = 'RENTAL_INVOICE' AND e.source_id = :invoiceId
                ORDER BY e.event_id DESC LIMIT 1
            `, { replacements: { invoiceId, cancelledBy }, type: QueryTypes.INSERT, transaction: t });
            return true;
        });
    },

    // ── E-invoice (IRN) ─────────────────────────────────────────────────────
    // City/PIN fall back to the tenant master for invoices finalised before the
    // tenant had them (they aren't printed, so the invoice itself is unchanged).
    getFinalInvoicesByIds: (locationCode, invoiceIds) => select(`
        SELECT i.*, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS invoice_date_iso,
               COALESCE(i.tenant_city, tn.city) AS tenant_city,
               COALESCE(i.tenant_pincode, tn.pincode) AS tenant_pincode
        FROM t_rental_invoice i
        JOIN m_rental_tenant tn ON tn.tenant_id = i.tenant_id
        WHERE i.location_code = :locationCode AND i.invoice_id IN (:invoiceIds) AND i.status = 'FINAL'
        ORDER BY i.invoice_no
    `, { locationCode, invoiceIds }),

    getInvoiceByNo: async (locationCode, invoiceNo) => {
        const rows = await select(`
            SELECT invoice_id, invoice_no, status, tenant_gstin, irn FROM t_rental_invoice
            WHERE location_code = :locationCode AND invoice_no = :invoiceNo
        `, { locationCode, invoiceNo });
        return rows[0] || null;
    },

    saveIrn: async (invoiceId, rec, importedBy) => {
        await db.sequelize.query(`
            UPDATE t_rental_invoice
            SET irn = :irn, irn_ack_no = :ackNo, irn_ack_date = :ackDt,
                irn_signed_qr = COALESCE(:signedQr, irn_signed_qr),
                irn_imported_by = :importedBy, irn_imported_date = NOW(), updated_by = :importedBy
            WHERE invoice_id = :invoiceId
        `, { replacements: { ...rec, invoiceId, importedBy }, type: QueryTypes.UPDATE });
    },

    // ── Tenant statement ────────────────────────────────────────────────────
    // Invoices (net of TDS, which is booked to TDS Receivable on the invoice) and
    // the rent receipts tagged to the tenant's label on bank statements, whole or split.
    getStatement: (locationCode, tenantId, fromDate, toDate) => select(`
        SELECT * FROM (
            SELECT i.invoice_date AS txn_date, 'Invoice' AS txn_type,
                   CONCAT('Invoice ', i.invoice_no, ' - ', i.description) AS particulars,
                   i.total_amount - i.tds_amount AS debit, 0 AS credit, i.tds_amount AS tds,
                   i.invoice_id AS ref_id
            FROM t_rental_invoice i
            WHERE i.location_code = :locationCode AND i.tenant_id = :tenantId AND i.status = 'FINAL'
              AND i.invoice_date BETWEEN :fromDate AND :toDate

            UNION ALL

            SELECT DATE(b.trans_date), 'Receipt', CONCAT(mb.bank_name, ' - ', COALESCE(b.remarks, '')),
                   0, b.credit_amount, 0, b.t_bank_id
            FROM t_bank_transaction b
            JOIN m_bank mb ON mb.bank_id = b.bank_id
            JOIN m_rental_tenant tn ON tn.tenant_id = :tenantId
            WHERE mb.location_code = :locationCode
              AND COALESCE(b.is_split, 'N') <> 'Y'
              AND b.ledger_name = CONCAT('RENT - ', tn.tenant_name)
              AND DATE(b.trans_date) BETWEEN :fromDate AND :toDate

            UNION ALL

            SELECT DATE(b.trans_date), 'Receipt', CONCAT(mb.bank_name, ' - ', COALESCE(s.remarks, b.remarks, ''), ' (split)'),
                   0, s.amount, 0, b.t_bank_id
            FROM t_bank_transaction_splits s
            JOIN t_bank_transaction b ON b.t_bank_id = s.t_bank_id
            JOIN m_bank mb ON mb.bank_id = b.bank_id
            JOIN m_rental_tenant tn ON tn.tenant_id = :tenantId
            WHERE mb.location_code = :locationCode
              AND s.ledger_name = CONCAT('RENT - ', tn.tenant_name)
              AND DATE(b.trans_date) BETWEEN :fromDate AND :toDate
        ) x
        ORDER BY txn_date, txn_type = 'Receipt', ref_id
    `, { locationCode, tenantId, fromDate, toDate }),

    getOpeningBalance: async (locationCode, tenantId, beforeDate) => {
        const [row] = await select(`
            SELECT
              (SELECT COALESCE(SUM(i.total_amount - i.tds_amount), 0) FROM t_rental_invoice i
               WHERE i.location_code = :locationCode AND i.tenant_id = :tenantId AND i.status = 'FINAL'
                 AND i.invoice_date < :beforeDate)
            - (SELECT COALESCE(SUM(b.credit_amount), 0) FROM t_bank_transaction b
               JOIN m_bank mb ON mb.bank_id = b.bank_id
               JOIN m_rental_tenant tn ON tn.tenant_id = :tenantId
               WHERE mb.location_code = :locationCode AND COALESCE(b.is_split, 'N') <> 'Y'
                 AND b.ledger_name = CONCAT('RENT - ', tn.tenant_name) AND DATE(b.trans_date) < :beforeDate)
            - (SELECT COALESCE(SUM(s.amount), 0) FROM t_bank_transaction_splits s
               JOIN t_bank_transaction b ON b.t_bank_id = s.t_bank_id
               JOIN m_bank mb ON mb.bank_id = b.bank_id
               JOIN m_rental_tenant tn ON tn.tenant_id = :tenantId
               WHERE mb.location_code = :locationCode
                 AND s.ledger_name = CONCAT('RENT - ', tn.tenant_name) AND DATE(b.trans_date) < :beforeDate)
            AS opening
        `, { locationCode, tenantId, beforeDate });
        return Number(row.opening || 0);
    },

    // ── GST: FINAL rental invoices in a period ──
    getGstInvoices: (locationCode, fromDate, toDate) => select(`
        SELECT i.invoice_no, i.invoice_date, i.tenant_name, i.tenant_gstin, i.sac_code, i.description, i.irn,
               i.taxable_value, i.cgst_rate, i.sgst_rate, i.cgst_amount, i.sgst_amount, i.total_amount
        FROM t_rental_invoice i
        WHERE i.location_code = :locationCode AND i.status = 'FINAL'
          AND i.invoice_date BETWEEN :fromDate AND :toDate
        ORDER BY i.invoice_no
    `, { locationCode, fromDate, toDate }),
};

// ── helpers that run inside a caller's transaction ──────────────────────────

async function ensureTenantLedger(locationCode, tenantId, tenantName, by, t) {
    const [existing] = await select(`
        SELECT l.ledger_id, g.group_name FROM gl_ledgers l
        JOIN gl_ledger_groups g ON g.group_id = l.group_id
        WHERE l.location_code = :locationCode AND l.ledger_name = :tenantName
    `, { locationCode, tenantName }, t);
    if (existing) {
        if (existing.group_name !== 'Sundry Debtors') {
            throw new Error(`A ledger named "${tenantName}" already exists under ${existing.group_name}. Use a different tenant name.`);
        }
        return existing.ledger_id;
    }

    const [group] = await select(`
        SELECT group_id FROM gl_ledger_groups WHERE location_code = :locationCode AND group_name = 'Sundry Debtors' LIMIT 1
    `, { locationCode }, t);
    if (!group) throw new Error('This location has no "Sundry Debtors" ledger group. Set up GL accounting first.');

    const [ledgerId] = await db.sequelize.query(`
        INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, source_id, active_flag, created_by, updated_by)
        VALUES (:locationCode, :tenantName, :groupId, 'TENANT', :tenantId, 'Y', :by, :by)
    `, { replacements: { locationCode, tenantName, groupId: group.group_id, tenantId, by }, type: QueryTypes.INSERT, transaction: t });
    return ledgerId;
}

// One bank-reconciliation rule per tenant on the rent bank ("RENT - <tenant>",
// credits only), mapped in gl_static_ledger_map to the tenant's ledger, so a rent
// credit tagged on the bank statement posts Bank Dr / Tenant Cr. Rules for tenants
// that were renamed or removed, or on a bank no longer used for rent, are dropped.
async function syncReceiptRules(locationCode, by, t) {
    const [settings] = await select(`SELECT rent_bank_id FROM m_rental_settings WHERE location_code = :locationCode`,
        { locationCode }, t);
    const tenants = await select(`SELECT tenant_id, tenant_name, ledger_id FROM m_rental_tenant WHERE location_code = :locationCode`,
        { locationCode }, t);
    const bankId = settings ? settings.rent_bank_id : null;
    const labels = tenants.map(tn => receiptLabel(tn.tenant_name));

    // Drop stale RENT - rules (renamed/deleted tenants, or another bank)
    await db.sequelize.query(`
        DELETE FROM m_ledger_rules
        WHERE location_code = :locationCode AND source_type = 'Static' AND ledger_name LIKE 'RENT - %'
          AND (bank_id <> :bankId OR :bankId = 0 OR ledger_name NOT IN (:labels))
    `, { replacements: { locationCode, bankId: bankId || 0, labels: labels.length ? labels : [''] }, type: QueryTypes.DELETE, transaction: t });

    for (const tn of tenants) {
        const label = receiptLabel(tn.tenant_name);
        if (bankId) {
            await db.sequelize.query(`
                INSERT INTO m_ledger_rules
                    (location_code, bank_id, source_type, external_id, ledger_name, allowed_entry_type,
                     notes_required_flag, allow_split_flag, created_by, updated_by, effective_start_date)
                SELECT :locationCode, :bankId, 'Static', NULL, :label, 'CREDIT', 'N', 'Y', :by, :by, CURDATE()
                FROM DUAL
                WHERE NOT EXISTS (SELECT 1 FROM m_ledger_rules
                                  WHERE location_code = :locationCode AND bank_id = :bankId
                                    AND source_type = 'Static' AND ledger_name = :label)
            `, { replacements: { locationCode, bankId, label, by }, type: QueryTypes.INSERT, transaction: t });
        }
        await db.sequelize.query(`
            INSERT INTO gl_static_ledger_map (location_code, ledger_name, treatment, gl_ledger_id, created_by, updated_by)
            VALUES (:locationCode, :label, 'POST', :ledgerId, :by, :by)
            ON DUPLICATE KEY UPDATE treatment = 'POST', gl_ledger_id = VALUES(gl_ledger_id), updated_by = VALUES(updated_by)
        `, { replacements: { locationCode, label, ledgerId: tn.ledger_id, by }, type: QueryTypes.INSERT, transaction: t });
    }
}

module.exports = RentalDao;
