// dao/oil-portal-credential-dao.js
// Portal logins for oil company accounts (m_oil_portal_credential). password_enc is produced by
// utils/secret-box and is never sent to the browser.
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

module.exports = {
    // Login status per account for a location, without the password
    findStatusByLocation: (locationCode) => {
        return db.sequelize.query(
            `SELECT c.bank_id, c.portal_code, c.username,
                    c.last_pull_at, c.last_pull_status, c.last_pull_message, c.updation_date
             FROM m_oil_portal_credential c
             JOIN m_bank b ON b.bank_id = c.bank_id
             WHERE c.location_code = :locationCode
               AND b.active_flag = 'Y'`,
            { replacements: { locationCode }, type: QueryTypes.SELECT }
        );
    },

    findForBank: async (bankId, locationCode) => {
        const rows = await db.sequelize.query(
            `SELECT c.*, b.template_id, b.is_oil_company
             FROM m_oil_portal_credential c
             JOIN m_bank b ON b.bank_id = c.bank_id
             WHERE c.bank_id = :bankId
               AND c.location_code = :locationCode
               AND b.active_flag = 'Y'`,
            { replacements: { bankId, locationCode }, type: QueryTypes.SELECT }
        );
        return rows[0] || null;
    },

    // Oil company account owned by this location (guards every write)
    findOilAccount: async (bankId, locationCode) => {
        const rows = await db.sequelize.query(
            `SELECT bank_id, bank_name, account_nickname, template_id
             FROM m_bank
             WHERE bank_id = :bankId
               AND location_code = :locationCode
               AND is_oil_company = 'Y'
               AND active_flag = 'Y'`,
            { replacements: { bankId, locationCode }, type: QueryTypes.SELECT }
        );
        return rows[0] || null;
    },

    upsert: ({ bankId, locationCode, portalCode, username, passwordEnc, userId }) => {
        return db.sequelize.query(
            `INSERT INTO m_oil_portal_credential
                (bank_id, location_code, portal_code, username, password_enc, created_by, updated_by)
             VALUES (:bankId, :locationCode, :portalCode, :username, :passwordEnc, :userId, :userId)
             ON DUPLICATE KEY UPDATE
                portal_code = VALUES(portal_code),
                username = VALUES(username),
                password_enc = VALUES(password_enc),
                last_pull_status = NULL,
                last_pull_message = NULL,
                updated_by = VALUES(updated_by)`,
            {
                replacements: { bankId, locationCode, portalCode, username, passwordEnc, userId: String(userId || '') },
                type: QueryTypes.INSERT
            }
        );
    },

    remove: (bankId, locationCode) => {
        return db.sequelize.query(
            `DELETE FROM m_oil_portal_credential WHERE bank_id = :bankId AND location_code = :locationCode`,
            { replacements: { bankId, locationCode }, type: QueryTypes.DELETE }
        );
    },

    recordPull: (bankId, status, message) => {
        return db.sequelize.query(
            `UPDATE m_oil_portal_credential
             SET last_pull_at = NOW(), last_pull_status = :status, last_pull_message = :message
             WHERE bank_id = :bankId`,
            { replacements: { bankId, status, message: String(message || '').slice(0, 500) }, type: QueryTypes.UPDATE }
        );
    },

    // ---- Portal health (m_oil_portal_health): one row per portal, written by the health check ----

    getPortalHealth: async (portalCode) => {
        const rows = await db.sequelize.query(
            `SELECT portal_code, status, detail, checked_at, status_since, last_ok_at,
                    TIMESTAMPDIFF(MINUTE, checked_at, NOW()) AS minutes_since_check
             FROM m_oil_portal_health WHERE portal_code = :portalCode`,
            { replacements: { portalCode }, type: QueryTypes.SELECT }
        );
        return rows[0] || null;
    },

    savePortalHealth: (portalCode, status, detail) => {
        return db.sequelize.query(
            `INSERT INTO m_oil_portal_health (portal_code, status, detail, checked_at, status_since, last_ok_at)
             VALUES (:portalCode, :status, :detail, NOW(), NOW(), IF(:status = 'OK', NOW(), NULL))
             ON DUPLICATE KEY UPDATE
                status_since = IF(status = VALUES(status), status_since, NOW()),
                last_ok_at   = IF(VALUES(status) = 'OK', NOW(), last_ok_at),
                status       = VALUES(status),
                detail       = VALUES(detail),
                checked_at   = NOW()`,
            { replacements: { portalCode, status, detail: String(detail || '').slice(0, 500) }, type: QueryTypes.INSERT }
        );
    },

    // Is the IOCL pull switched on anywhere? (no point checking the portal otherwise)
    isPortalPullEnabledAnywhere: async () => {
        const rows = await db.sequelize.query(
            `SELECT 1 FROM m_location_config
             WHERE setting_name = 'IOCL_PORTAL_PULL_ENABLED' AND UPPER(setting_value) = 'Y'
               AND CURDATE() BETWEEN effective_start_date AND effective_end_date
             LIMIT 1`,
            { type: QueryTypes.SELECT }
        );
        return rows.length > 0;
    },

    // ---- Portal login attempt log (t_oil_portal_login_attempt) ----

    startAttempt: async ({ bankId, locationCode, purpose, fromDate, toDate, userId }) => {
        const [id] = await db.sequelize.query(
            `INSERT INTO t_oil_portal_login_attempt
                (bank_id, location_code, purpose, from_date, to_date, created_by)
             VALUES (:bankId, :locationCode, :purpose, :fromDate, :toDate, :userId)`,
            {
                replacements: { bankId, locationCode, purpose, fromDate: fromDate || null, toDate: toDate || null, userId: String(userId || '') },
                type: QueryTypes.INSERT
            }
        );
        return id;
    },

    finishAttempt: (attemptId, result, message) => {
        return db.sequelize.query(
            `UPDATE t_oil_portal_login_attempt
             SET result = :result, message = :message, finished_at = NOW()
             WHERE attempt_id = :attemptId`,
            { replacements: { attemptId, result, message: String(message || '').slice(0, 500) }, type: QueryTypes.UPDATE }
        );
    },

    // Everything the safeguards need, computed in the DB clock (IST)
    getAttemptStats: async (bankId) => {
        const [row] = await db.sequelize.query(
                `SELECT
                    (SELECT COUNT(*) FROM t_oil_portal_login_attempt
                      WHERE bank_id = :bankId AND started_at >= CURDATE()) AS today_count,
                    (SELECT COUNT(*) FROM t_oil_portal_login_attempt
                      WHERE bank_id = :bankId AND result = 'RUNNING'
                        AND started_at > NOW() - INTERVAL 10 MINUTE) AS running_count,
                    (SELECT TIMESTAMPDIFF(SECOND, MAX(started_at), NOW()) FROM t_oil_portal_login_attempt
                      WHERE bank_id = :bankId AND purpose IN ('PULL', 'INVOICE')) AS secs_since_last_pull`,
                { replacements: { bankId }, type: QueryTypes.SELECT }
            );
        // Consecutive LOGIN_FAILED since the last successful login (other errors don't count either way)
        const recent = await db.sequelize.query(
            `SELECT result, started_at >= CURDATE() AS is_today
             FROM t_oil_portal_login_attempt
             WHERE bank_id = :bankId AND result IN ('OK', 'LOGIN_FAILED')
             ORDER BY attempt_id DESC LIMIT 10`,
            { replacements: { bankId }, type: QueryTypes.SELECT }
        );
        let failStreak = 0, failStreakToday = 0;
        for (const r of recent) {
            if (r.result !== 'LOGIN_FAILED') break;
            failStreak++;
            if (Number(r.is_today) === 1) failStreakToday++;
        }
        return {
            todayCount: Number(row.today_count) || 0,
            running: Number(row.running_count) > 0,
            secsSinceLastPull: row.secs_since_last_pull === null ? null : Number(row.secs_since_last_pull),
            failStreak,
            failStreakToday
        };
    },

    // Server-wide: accounts whose IOCL login failed in the last hour, newest first, with how many
    // minutes ago (DB clock). Used to stop all pulls if IOCL appears to be pushing back.
    getRecentFailingAccounts: (windowMinutes) => {
        return db.sequelize.query(
            `SELECT bank_id, TIMESTAMPDIFF(SECOND, MAX(started_at), NOW()) AS secs_ago
             FROM t_oil_portal_login_attempt
             WHERE result IN ('LOGIN_FAILED', 'ERROR')
               AND started_at > NOW() - INTERVAL :windowMinutes MINUTE
             GROUP BY bank_id
             ORDER BY secs_ago ASC`,
            { replacements: { windowMinutes }, type: QueryTypes.SELECT }
        );
    },

    // Last statement date already loaded for the account (default "from" date for a pull)
    getLastTransactionDate: async (bankId) => {
        const rows = await db.sequelize.query(
            `SELECT DATE_FORMAT(MAX(trans_date), '%Y-%m-%d') AS last_date
             FROM t_bank_transaction
             WHERE bank_id = :bankId`,
            { replacements: { bankId }, type: QueryTypes.SELECT }
        );
        return rows[0] ? rows[0].last_date : null;
    }
};
