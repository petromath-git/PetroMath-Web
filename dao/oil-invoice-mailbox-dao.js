// dao/oil-invoice-mailbox-dao.js — IOCL Invoices email import (tkt #484):
// m_oil_invoice_mailbox(_location), t_oil_invoice_email_log.
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

const select = (sql, replacements, transaction) =>
    db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

const withLocations = async (boxes) => {
    if (!boxes.length) return boxes;
    const rows = await select(`
        SELECT mailbox_id, location_code FROM m_oil_invoice_mailbox_location
        WHERE mailbox_id IN (:ids) ORDER BY location_code
    `, { ids: boxes.map(b => b.mailbox_id) });
    boxes.forEach(b => { b.locations = rows.filter(r => r.mailbox_id === b.mailbox_id).map(r => r.location_code); });
    return boxes;
};

const MAILBOX_COLUMNS = `m.mailbox_id, m.email_address, m.access_mode, m.imap_host, m.imap_port, m.lookback_days, m.active_flag,
    m.last_run_at, m.last_status, m.last_message, m.updated_by, m.updation_date`;

const OilInvoiceMailboxDao = {
    // Mailboxes that serve a location (without the password).
    getMailboxesForLocation: async (locationCode) => withLocations(await select(`
        SELECT ${MAILBOX_COLUMNS} FROM m_oil_invoice_mailbox m
        WHERE EXISTS (SELECT 1 FROM m_oil_invoice_mailbox_location l WHERE l.mailbox_id = m.mailbox_id AND l.location_code = :locationCode)
        ORDER BY m.email_address
    `, { locationCode })),

    getMailbox: async (mailboxId) => {
        const [m] = await withLocations(await select(`SELECT ${MAILBOX_COLUMNS} FROM m_oil_invoice_mailbox m WHERE m.mailbox_id = :mailboxId`, { mailboxId }));
        return m || null;
    },

    getMailboxByEmail: async (email) => {
        const [m] = await select(`SELECT mailbox_id FROM m_oil_invoice_mailbox WHERE email_address = :email`, { email });
        return m || null;
    },

    // With the encrypted password: only for the importer.
    getMailboxSecret: async (mailboxId) => {
        const [m] = await select(`SELECT mailbox_id, email_address, imap_host, imap_port, password_enc, lookback_days
            FROM m_oil_invoice_mailbox WHERE mailbox_id = :mailboxId`, { mailboxId });
        return m || null;
    },

    // Active IMAP mailboxes for the scheduler; a failed login pauses one until its password is saved again.
    getMailboxesToRun: async () => withLocations(await select(`
        SELECT ${MAILBOX_COLUMNS} FROM m_oil_invoice_mailbox m
        WHERE m.active_flag = 'Y' AND m.access_mode = 'IMAP' AND COALESCE(m.last_status, '') <> 'LOGIN_FAILED'
        ORDER BY m.mailbox_id
    `)),

    // SCRIPT mailbox by the SHA-256 of the key its Google script sends.
    getMailboxByTokenHash: async (tokenHash) => {
        const [m] = await withLocations(await select(`SELECT ${MAILBOX_COLUMNS} FROM m_oil_invoice_mailbox m
            WHERE m.token_hash = :tokenHash AND m.access_mode = 'SCRIPT'`, { tokenHash }));
        return m || null;
    },

    setTokenHash: (mailboxId, tokenHash, by) => db.sequelize.query(`
        UPDATE m_oil_invoice_mailbox SET token_hash = :tokenHash, updated_by = :by, last_status = NULL,
               last_message = 'New script made; paste it in the Google script and press Run on setup' WHERE mailbox_id = :mailboxId
    `, { replacements: { mailboxId, tokenHash, by } }),

    createMailbox: (m, locations, by) => db.sequelize.transaction(async (t) => {
        const [mailboxId] = await db.sequelize.query(`
            INSERT INTO m_oil_invoice_mailbox (email_address, access_mode, password_enc, token_hash, lookback_days, active_flag, created_by, updated_by)
            VALUES (:email, :mode, :passwordEnc, :tokenHash, :lookbackDays, 'Y', :by, :by)
        `, { replacements: { email: m.email, mode: m.mode, passwordEnc: m.passwordEnc || null, tokenHash: m.tokenHash || null,
            lookbackDays: m.lookbackDays, by }, type: QueryTypes.INSERT, transaction: t });
        for (const loc of locations) {
            await db.sequelize.query(`INSERT INTO m_oil_invoice_mailbox_location (mailbox_id, location_code, created_by) VALUES (:mailboxId, :loc, :by)`,
                { replacements: { mailboxId, loc, by }, transaction: t });
        }
        return mailboxId;
    }),

    // passwordEnc null = keep the saved one. A new password clears a LOGIN_FAILED pause.
    updateMailbox: (mailboxId, m, locations, by) => db.sequelize.transaction(async (t) => {
        await db.sequelize.query(`
            UPDATE m_oil_invoice_mailbox
            SET lookback_days = :lookbackDays, active_flag = :active, updated_by = :by
                ${m.passwordEnc ? ", password_enc = :passwordEnc, last_status = NULL, last_message = 'Password changed'" : ''}
            WHERE mailbox_id = :mailboxId
        `, { replacements: { mailboxId, lookbackDays: m.lookbackDays, active: m.active, passwordEnc: m.passwordEnc || null, by }, transaction: t });
        await db.sequelize.query(`DELETE FROM m_oil_invoice_mailbox_location WHERE mailbox_id = :mailboxId`, { replacements: { mailboxId }, transaction: t });
        for (const loc of locations) {
            await db.sequelize.query(`INSERT INTO m_oil_invoice_mailbox_location (mailbox_id, location_code, created_by) VALUES (:mailboxId, :loc, :by)`,
                { replacements: { mailboxId, loc, by }, transaction: t });
        }
    }),

    deleteMailbox: (mailboxId) => db.sequelize.query(`DELETE FROM m_oil_invoice_mailbox WHERE mailbox_id = :mailboxId`, { replacements: { mailboxId } }),

    setRunResult: (mailboxId, status, message) => db.sequelize.query(`
        UPDATE m_oil_invoice_mailbox SET last_run_at = NOW(), last_status = :status, last_message = :message WHERE mailbox_id = :mailboxId
    `, { replacements: { mailboxId, status, message: String(message || '').substring(0, 500) } }),

    // ── Log ──────────────────────────────────────────────────────────────────
    // message_key|part_id already dealt with from this mailbox, for the given mails. A refused PDF
    // (BLOCKED / ERROR) is left out: when its mail is sent again it gets another try.
    getLoggedParts: async (mailboxId, messageKeys) => {
        if (!messageKeys.length) return new Set();
        const rows = await select(`
            SELECT message_key, part_id FROM t_oil_invoice_email_log
            WHERE mailbox_id = :mailboxId AND message_key IN (:messageKeys) AND status NOT IN ('BLOCKED', 'ERROR')
        `, { mailboxId, messageKeys });
        return new Set(rows.map(r => `${r.message_key}|${r.part_id}`));
    },

    // One row per PDF. A second try at a refused PDF replaces its row; any other row is never changed.
    addLog: async (row) => {
        const replacements = {
            mailbox_id: row.mailbox_id, message_key: String(row.message_key).substring(0, 255), part_id: row.part_id,
            mail_date: row.mail_date || null, mail_from: row.mail_from ? String(row.mail_from).substring(0, 200) : null,
            subject: row.subject ? String(row.subject).substring(0, 300) : null,
            file_name: row.file_name ? String(row.file_name).substring(0, 200) : null,
            status: row.status, location_code: row.location_code || null, invoice_no: row.invoice_no || null,
            invoice_id: row.invoice_id || null,
            recipient_gstin: row.recipient_gstin ? String(row.recipient_gstin).substring(0, 15) : null,
            detail: row.detail ? String(row.detail).substring(0, 500) : null, created_by: row.created_by || 'AUTO'
        };
        try {
            await db.sequelize.query(`
                INSERT INTO t_oil_invoice_email_log
                    (mailbox_id, message_key, part_id, mail_date, mail_from, subject, file_name, status, location_code, invoice_no, invoice_id, recipient_gstin, detail, created_by)
                VALUES (:mailbox_id, :message_key, :part_id, :mail_date, :mail_from, :subject, :file_name, :status, :location_code, :invoice_no, :invoice_id, :recipient_gstin, :detail, :created_by)
            `, { replacements });
        } catch (e) {
            if (!(e.parent && e.parent.code === 'ER_DUP_ENTRY')) throw e;
            await db.sequelize.query(`
                UPDATE t_oil_invoice_email_log
                SET status = :status, location_code = :location_code, invoice_no = :invoice_no, invoice_id = :invoice_id,
                    recipient_gstin = :recipient_gstin, detail = :detail, created_by = :created_by, creation_date = NOW()
                WHERE mailbox_id = :mailbox_id AND message_key = :message_key AND part_id = :part_id AND status IN ('BLOCKED', 'ERROR')
            `, { replacements });
        }
    },

    // Bunks (of the given ones) whose LFR invoices came in mails from this sender address.
    getLfrLocationsBySender: async (mailboxId, sender, locationCodes) => (await select(`
        SELECT DISTINCT i.location_code
        FROM t_oil_invoice_email_log g
        JOIN t_oil_co_invoice i ON i.invoice_id = g.invoice_id
        WHERE g.mailbox_id = :mailboxId AND i.charge_code = 'LFR' AND i.location_code IN (:codes)
          AND (LOWER(g.mail_from) = :sender OR LOCATE(:bracketed, LOWER(g.mail_from)) > 0)
    `, { mailboxId, sender, bracketed: `<${sender}>`, codes: locationCodes.length ? locationCodes : ['__none__'] })).map(r => r.location_code),

    // What a bunk's users see: the PDFs that are this bunk's, and the refused ones made out to its GSTIN
    // (bunks sharing a GSTIN all see those). Other PDFs no bunk could be told for: Administration page only.
    getLogForLocation: (locationCode, gstin, includeOther, limit) => select(`
        SELECT g.log_id, g.mailbox_id, g.mail_date, g.subject, g.file_name, g.status,
               g.location_code, g.invoice_no, g.invoice_id, g.detail, g.created_by, g.creation_date
        FROM t_oil_invoice_email_log g
        WHERE (g.location_code = :locationCode
               ${gstin ? "OR (g.location_code IS NULL AND g.status IN ('BLOCKED', 'ERROR') AND g.recipient_gstin = :gstin)" : ''})
          ${includeOther ? '' : "AND g.status <> 'NOT_INVOICE'"}
        ORDER BY g.creation_date DESC, g.log_id DESC
        LIMIT ${Number(limit) || 200}
    `, { locationCode, gstin: gstin || null }),

    // Administration: every mailbox's log (or one mailbox's), newest first.
    getLogAll: (mailboxId, includeOther, limit) => select(`
        SELECT g.log_id, g.mailbox_id, m.email_address, g.mail_date, g.mail_from, g.subject, g.file_name, g.status,
               g.location_code, g.invoice_no, g.invoice_id, g.detail, g.created_by, g.creation_date
        FROM t_oil_invoice_email_log g
        JOIN m_oil_invoice_mailbox m ON m.mailbox_id = g.mailbox_id
        WHERE 1 = 1
          ${mailboxId ? 'AND g.mailbox_id = :mailboxId' : ''}
          ${includeOther ? '' : "AND g.status <> 'NOT_INVOICE'"}
        ORDER BY g.creation_date DESC, g.log_id DESC
        LIMIT ${Number(limit) || 300}
    `, { mailboxId: mailboxId || null }),

    // Administration: all mailboxes.
    getAllMailboxes: async () => withLocations(await select(`SELECT ${MAILBOX_COLUMNS} FROM m_oil_invoice_mailbox m ORDER BY m.email_address`)),

    // Locations (of the given list, or all when null) that have an IOCL SAP account: the ones a mailbox can serve.
    getIoclLocations: (codes) => select(`
        SELECT DISTINCT b.location_code
        FROM m_bank b
        JOIN m_supplier s ON s.supplier_id = b.supplier_id
        WHERE b.is_oil_company = 'Y' AND b.active_flag = 'Y'
          AND REPLACE(UPPER(s.supplier_name), ' ', '') LIKE '%INDIANOIL%'
          ${codes ? 'AND b.location_code IN (:codes)' : ''}
        ORDER BY b.location_code
    `, { codes: codes && codes.length ? codes : ['__none__'] }),
};

module.exports = OilInvoiceMailboxDao;
