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
