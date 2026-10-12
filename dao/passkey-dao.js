// m_person_passkeys: phones a person has enabled Face ID / fingerprint login on.
const db = require("../db/db-connection");
const { QueryTypes } = require("sequelize");

module.exports = {
    findByCredentialId: async (credentialId) => {
        const rows = await db.sequelize.query(
            `SELECT * FROM m_person_passkeys WHERE credential_id = :credentialId`,
            { replacements: { credentialId }, type: QueryTypes.SELECT });
        return rows[0] || null;
    },

    listByPerson: (personId) => db.sequelize.query(
        `SELECT passkey_id, credential_id, transports, device_label, created_at, last_used_at
         FROM m_person_passkeys WHERE person_id = :personId ORDER BY created_at`,
        { replacements: { personId }, type: QueryTypes.SELECT }),

    create: (p) => db.sequelize.query(
        `INSERT INTO m_person_passkeys
            (person_id, credential_id, public_key, sign_count, transports, device_label, password_sig)
         VALUES (:personId, :credentialId, :publicKey, :signCount, :transports, :deviceLabel, :passwordSig)`,
        { replacements: p }),

    markUsed: (passkeyId, signCount) => db.sequelize.query(
        `UPDATE m_person_passkeys SET sign_count = :signCount, last_used_at = NOW() WHERE passkey_id = :passkeyId`,
        { replacements: { passkeyId, signCount } }),

    deleteById: (passkeyId) => db.sequelize.query(
        `DELETE FROM m_person_passkeys WHERE passkey_id = :passkeyId`,
        { replacements: { passkeyId } }),

    deleteByPerson: (personId) => db.sequelize.query(
        `DELETE FROM m_person_passkeys WHERE person_id = :personId`,
        { replacements: { personId } })
};
