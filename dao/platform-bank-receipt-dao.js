// dao/platform-bank-receipt-dao.js
// PetroMath's own bank statement (tkt #459). Separate from the location bank
// tables on purpose: nothing here touches m_bank, t_bank_transaction or GL.
const db = require("../db/db-connection");
const { QueryTypes } = require("sequelize");

const select = (sql, replacements = {}, options = {}) =>
    db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, ...options });

const PlatformBankReceiptDao = {

    transaction: (fn) => db.sequelize.transaction(fn),

    // ─── Uploads ───────────────────────────────────────────────────────────

    // Adds the lines not seen before; a line already uploaded is skipped by
    // its dedup_key. Returns the upload row's id and the two counts.
    saveUpload: (fileName, lines, userId) => {
        return db.sequelize.transaction(async (t) => {
            const dates = lines.map(l => l.txn_date).sort();
            const [uploadId] = await db.sequelize.query(
                `INSERT INTO t_platform_bank_upload (file_name, from_date, to_date, created_by)
                 VALUES (:fileName, :fromDate, :toDate, :userId)`,
                {
                    replacements: { fileName, fromDate: dates[0] || null, toDate: dates[dates.length - 1] || null, userId },
                    type: QueryTypes.INSERT,
                    transaction: t
                }
            );

            let added = 0;
            for (const line of lines) {
                const [, affected] = await db.sequelize.query(
                    `INSERT IGNORE INTO t_platform_bank_txn
                        (upload_id, txn_date, description, reference, payer_name, credit_amount, balance_amount, dedup_key)
                     VALUES (:uploadId, :txn_date, :description, :reference, :payer_name, :credit_amount, :balance_amount, :dedup_key)`,
                    { replacements: { uploadId, ...line }, type: QueryTypes.INSERT, transaction: t }
                );
                added += affected;
            }

            const skipped = lines.length - added;
            await db.sequelize.query(
                `UPDATE t_platform_bank_upload SET lines_added = :added, lines_skipped = :skipped WHERE upload_id = :uploadId`,
                { replacements: { added, skipped, uploadId }, type: QueryTypes.UPDATE, transaction: t }
            );
            return { uploadId, added, skipped };
        });
    },

    findRecentUploads: () => select(
        `SELECT u.*,
                (SELECT COUNT(*) FROM t_platform_bank_txn t WHERE t.upload_id = u.upload_id AND t.status = 'UNTAGGED') AS untagged_count
         FROM t_platform_bank_upload u
         ORDER BY u.upload_id DESC
         LIMIT 10`
    ),

    // Removes only what nothing depends on yet: tagged lines stay
    removeUntaggedLines: async (uploadId) => {
        const [, affected] = await db.sequelize.query(
            `DELETE FROM t_platform_bank_txn WHERE upload_id = :uploadId AND status = 'UNTAGGED'`,
            { replacements: { uploadId }, type: QueryTypes.RAW }
        );
        return affected && affected.affectedRows !== undefined ? affected.affectedRows : 0;
    },

    // ─── Statement lines ───────────────────────────────────────────────────

    findLine: (bankTxnId) => select(
        `SELECT * FROM t_platform_bank_txn WHERE bank_txn_id = :bankTxnId`, { bankTxnId }
    ).then(rows => rows[0] || null),

    findLines: (status) => select(
        `SELECT t.*, l.location_name,
                GROUP_CONCAT(CONCAT('#', lk.payment_id) ORDER BY lk.payment_id SEPARATOR ', ') AS payment_refs,
                MAX(lk.created_payment) AS has_created_payment
         FROM t_platform_bank_txn t
         LEFT JOIN m_location l ON l.location_code = t.location_code
         LEFT JOIN t_platform_bank_txn_payment lk ON lk.bank_txn_id = t.bank_txn_id
         WHERE (:status IS NULL OR t.status = :status)
         GROUP BY t.bank_txn_id
         ORDER BY t.txn_date DESC, t.bank_txn_id DESC
         LIMIT 1000`,
        { status: status || null }
    ),

    findUntaggedOldestFirst: () => select(
        `SELECT * FROM t_platform_bank_txn WHERE status = 'UNTAGGED' ORDER BY txn_date, bank_txn_id`
    ),

    countsByStatus: () => select(
        `SELECT status, COUNT(*) AS n, SUM(credit_amount) AS amount FROM t_platform_bank_txn GROUP BY status`
    ),

    // Conditional on the current status so a double click can't tag a line twice.
    // Returns the number of rows changed: 0 = someone else got there first.
    setLineStatus: async (bankTxnId, fromStatus, toStatus, locationCode, userId) => {
        const [, affected] = await db.sequelize.query(
            `UPDATE t_platform_bank_txn
             SET status = :toStatus, location_code = :locationCode, tagged_by = :userId,
                 tagged_date = IF(:toStatus = 'UNTAGGED', NULL, NOW())
             WHERE bank_txn_id = :bankTxnId AND status = :fromStatus`,
            {
                replacements: { bankTxnId, fromStatus, toStatus, locationCode: locationCode || null, userId },
                type: QueryTypes.UPDATE
            }
        );
        return affected;
    },

    // ─── Payments still to be connected to the statement ───────────────────

    // remaining = the part of each payment no statement line accounts for yet
    findUnlinkedPayments: (options = {}) => select(
        `SELECT p.payment_id, p.location_code, p.payment_date, p.amount, p.payment_mode, p.reference_number,
                p.amount - COALESCE(SUM(lk.linked_amount), 0) AS remaining
         FROM t_platform_payment p
         LEFT JOIN t_platform_bank_txn_payment lk ON lk.payment_id = p.payment_id
         WHERE p.status NOT IN ('FAILED', 'REFUNDED')
         GROUP BY p.payment_id
         HAVING remaining > 0.005
         ORDER BY p.payment_date DESC, p.payment_id DESC`,
        {},
        options
    ),

    // Locks the payment so two lines can't both claim its remaining amount
    findPaymentRemainingForUpdate: async (paymentId, t) => {
        const rows = await select(
            `SELECT payment_id, location_code, amount FROM t_platform_payment WHERE payment_id = :paymentId FOR UPDATE`,
            { paymentId },
            { transaction: t }
        );
        if (!rows[0]) return null;
        const linked = await select(
            `SELECT COALESCE(SUM(linked_amount), 0) AS linked FROM t_platform_bank_txn_payment WHERE payment_id = :paymentId`,
            { paymentId },
            { transaction: t }
        );
        return { ...rows[0], remaining: Number(rows[0].amount) - Number(linked[0].linked) };
    },

    addLink: (bankTxnId, paymentId, linkedAmount, createdPayment, userId, t) => db.sequelize.query(
        `INSERT INTO t_platform_bank_txn_payment (bank_txn_id, payment_id, linked_amount, created_payment, created_by)
         VALUES (:bankTxnId, :paymentId, :linkedAmount, :createdPayment, :userId)`,
        {
            replacements: { bankTxnId, paymentId, linkedAmount, createdPayment: createdPayment ? 1 : 0, userId },
            type: QueryTypes.INSERT,
            transaction: t
        }
    ),

    findLinks: (bankTxnId) => select(
        `SELECT * FROM t_platform_bank_txn_payment WHERE bank_txn_id = :bankTxnId`, { bankTxnId }
    ),

    deleteLinks: (bankTxnId, t) => db.sequelize.query(
        `DELETE FROM t_platform_bank_txn_payment WHERE bank_txn_id = :bankTxnId`,
        { replacements: { bankTxnId }, type: QueryTypes.RAW, transaction: t }
    ),

    // ─── Removing a payment that tagging created ───────────────────────────

    // Commission already paid out to the distributor: the payment can't just vanish
    countPaidCommissions: (paymentId) => select(
        `SELECT COUNT(*) AS n
         FROM t_distributor_commission c
         WHERE c.payment_id = :paymentId
           AND (c.status = 'PAID'
                OR EXISTS (SELECT 1 FROM t_distributor_payout_allocation a WHERE a.commission_id = c.commission_id))`,
        { paymentId }
    ).then(rows => Number(rows[0].n)),

    findAllocatedInvoiceIds: (paymentId) => select(
        `SELECT invoice_id FROM t_platform_payment_allocation WHERE payment_id = :paymentId`, { paymentId }
    ).then(rows => rows.map(r => r.invoice_id)),

    // Allocations and the pending commission go with it (ON DELETE CASCADE)
    deletePayment: (paymentId, t) => db.sequelize.query(
        `DELETE FROM t_platform_payment WHERE payment_id = :paymentId`,
        { replacements: { paymentId }, type: QueryTypes.RAW, transaction: t }
    ),

    // ─── Remembered payers ─────────────────────────────────────────────────

    findAliases: () => select(`SELECT match_text, location_code FROM m_platform_payer_alias`),

    // overwrite = the user set this location by hand, so it corrects an older answer;
    // otherwise (bulk apply) the first answer stands
    saveAlias: (matchText, locationCode, userId, overwrite) => db.sequelize.query(
        overwrite
            ? `INSERT INTO m_platform_payer_alias (match_text, location_code, created_by)
               VALUES (:matchText, :locationCode, :userId)
               ON DUPLICATE KEY UPDATE location_code = VALUES(location_code)`
            : `INSERT IGNORE INTO m_platform_payer_alias (match_text, location_code, created_by)
               VALUES (:matchText, :locationCode, :userId)`,
        { replacements: { matchText, locationCode, userId }, type: QueryTypes.INSERT }
    )
};

module.exports = PlatformBankReceiptDao;
