// dao/account-heads-dao.js
const db = require("../db/db-connection");
const { QueryTypes } = require("sequelize");

module.exports = {
    getAccountHeads: async (locationCode, includeInactive = false) => {
        let query = `
            SELECT
                ah.account_head_id,
                ah.account_head_name,
                ah.account_head_type,
                ah.allowed_entry_type,
                ah.notes_required_flag,
                ah.active_flag,
                ah.is_system_type,
                ah.effective_start_date,
                ah.effective_end_date,
                ah.gl_group_id,
                g.group_name AS gl_group_name,
                ah.created_by,
                ah.updated_by,
                ah.creation_date,
                ah.updation_date
            FROM m_account_heads ah
            LEFT JOIN gl_ledger_groups g ON g.group_id = ah.gl_group_id
            WHERE ah.location_code = :locationCode
        `;

        if (!includeInactive) query += " AND ah.active_flag = 'Y'";
        query += " ORDER BY ah.account_head_type, ah.account_head_name";

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
        const existing = await module.exports.getAccountHeadById(data.account_head_id);
        if (existing && existing.is_system_type === 'Y' && existing.account_head_name !== data.account_head_name) {
            throw new Error(`'${existing.account_head_name}' is a system-generated account head (used by cashflow auto-generation) and cannot be renamed`);
        }

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
        const existing = await module.exports.getAccountHeadById(id);
        if (existing && existing.is_system_type === 'Y') {
            throw new Error(`'${existing.account_head_name}' is a system-generated account head (used by cashflow auto-generation) and cannot be deactivated`);
        }

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

    updateGlGroup: async (id, glGroupId, updatedBy) => {
        // 1. Update m_account_heads
        await db.sequelize.query(`
            UPDATE m_account_heads
            SET gl_group_id   = :glGroupId,
                updated_by    = :updatedBy,
                updation_date = NOW()
            WHERE account_head_id = :id
        `, {
            replacements: { id, glGroupId: glGroupId || null, updatedBy },
            type: QueryTypes.UPDATE
        });

        if (!glGroupId) return; // cleared — nothing to sync to gl_ledgers

        // 2. Update gl_ledgers entry if it already exists
        await db.sequelize.query(`
            UPDATE gl_ledgers
            SET group_id   = :glGroupId,
                updated_by = :updatedBy
            WHERE source_type = 'STATIC'
              AND source_id   = :id
        `, {
            replacements: { id, glGroupId, updatedBy },
            type: QueryTypes.UPDATE
        });

        // 3. Create gl_ledgers entry if it was missing (skipped in initial population)
        await db.sequelize.query(`
            INSERT IGNORE INTO gl_ledgers
                (location_code, ledger_name, group_id, source_type, source_id, created_by)
            SELECT ah.location_code, ah.account_head_name, :glGroupId, 'STATIC', ah.account_head_id, :updatedBy
            FROM m_account_heads ah
            WHERE ah.account_head_id = :id
        `, {
            replacements: { id, glGroupId, updatedBy },
            type: QueryTypes.INSERT
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