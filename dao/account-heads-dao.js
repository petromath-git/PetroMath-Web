// dao/account-heads-dao.js
const db = require("../db/db-connection");
const { QueryTypes } = require("sequelize");

module.exports = {
    getAccountHeads: async (locationCode, includeInactive = false) => {
        let query = `
            SELECT 
                account_head_id,
                account_head_name,
                account_head_type,
                allowed_entry_type,
                notes_required_flag,
                active_flag,
                effective_start_date,
                effective_end_date,
                created_by,
                updated_by,
                creation_date,
                updation_date
            FROM m_account_heads
            WHERE location_code = :locationCode
        `;

        if (!includeInactive) query += " AND active_flag = 'Y'";
        query += " ORDER BY account_head_type, account_head_name";

        return await db.sequelize.query(query, {
            replacements: { locationCode },
            type: QueryTypes.SELECT
        });
    },

    createAccountHead: async (data) => {
        const query = `
            INSERT INTO m_account_heads (
                location_code,
                account_head_name,
                account_head_type,
                allowed_entry_type,
                notes_required_flag,
                active_flag,
                effective_start_date,
                effective_end_date,
                created_by
            ) VALUES (
                :location_code,
                :account_head_name,
                :account_head_type,
                :allowed_entry_type,
                :notes_required_flag,
                :active_flag,
                :effective_start_date,
                :effective_end_date,
                :created_by
            )
        `;
        return await db.sequelize.query(query, {
            replacements: data,
            type: QueryTypes.INSERT
        });
    },

    updateAccountHead: async (data) => {
        const query = `
            UPDATE m_account_heads
            SET
                account_head_name = :account_head_name,
                account_head_type = :account_head_type,
                allowed_entry_type = :allowed_entry_type,
                notes_required_flag = :notes_required_flag,
                active_flag = :active_flag,
                effective_start_date = :effective_start_date,
                effective_end_date = :effective_end_date,
                updated_by = :updated_by,
                updation_date = NOW()
            WHERE account_head_id = :account_head_id
        `;
        return await db.sequelize.query(query, {
            replacements: data,
            type: QueryTypes.UPDATE
        });
    },

    deactivateAccountHead: async (id, user) => {
        const query = `
            UPDATE m_account_heads
            SET active_flag = 'N',
                updated_by = :user,
                updation_date = NOW()
            WHERE account_head_id = :id
        `;
        return await db.sequelize.query(query, {
            replacements: { id, user },
            type: QueryTypes.UPDATE
        });
    },

    getAccountHeadById: async (id) => {
        const query = `
            SELECT *
            FROM m_account_heads
            WHERE account_head_id = :id
            LIMIT 1
        `;
        const result = await db.sequelize.query(query, {
            replacements: { id },
            type: QueryTypes.SELECT
        });
        return result[0] || null;
    }
};