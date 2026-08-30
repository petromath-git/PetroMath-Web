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
        query += " ORDER BY ah.account_head_name";

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
        const result = await db.sequelize.query(query, {
            replacements: data,
            type: QueryTypes.INSERT
        });

        // Every Account Head IS a Static Ledger by definition — register it in
        // gl_static_ledger_map right away (unreviewed) so it shows up on the
        // review screen from day one, rather than relying on the GL engine to
        // discover it reactively the first time some transaction happens to use
        // that exact name. That reactive-only path is also what lets things
        // that were never really Static (e.g. a mis-linked customer name) end
        // up looking identical to a deliberately-defined Static ledger.
        await db.sequelize.query(`
            INSERT IGNORE INTO gl_static_ledger_map (location_code, ledger_name, created_by, updated_by)
            VALUES (:location_code, :account_head_name, :created_by, :created_by)
        `, {
            replacements: data,
            type: QueryTypes.INSERT
        });

        return result;
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
                notes_required_flag = :notes_required_flag,
                active_flag = :active_flag,
                effective_start_date = :effective_start_date,
                effective_end_date = :effective_end_date,
                updated_by = :updated_by,
                updation_date = NOW()
            WHERE account_head_id = :account_head_id
        `;
        const result = await db.sequelize.query(query, {
            replacements: data,
            type: QueryTypes.UPDATE
        });

        if (existing && existing.account_head_name !== data.account_head_name) {
            // m_ledger_rules.ledger_name (Static rows) is copied from the
            // account head dropdown at rule-creation time (see
            // AccountHeadsController.createRule) — external_id is a live FK
            // to account_head_id, so it's safe to update this one in place.
            // It drives what name gets stamped onto NEW t_bank_transaction
            // rows going forward (via m_bank_allowed_ledgers_v).
            await db.sequelize.query(`
                UPDATE m_ledger_rules
                SET ledger_name = :newName, updated_by = :updated_by, updation_date = NOW()
                WHERE source_type = 'Static' AND external_id = :account_head_id
            `, {
                replacements: {
                    newName: data.account_head_name,
                    updated_by: data.updated_by,
                    account_head_id: data.account_head_id
                },
                type: QueryTypes.UPDATE
            });

            // gl_static_ledger_map.ledger_name is NOT joined live to this
            // table — it's the exact-text match key against
            // t_bank_transaction.ledger_name, a frozen stamp copied onto each
            // transaction at classification time. Existing transactions still
            // carry the OLD name and must keep matching it, so renaming the
            // row in place would orphan them. Instead carry the existing
            // review (treatment/gl_ledger_id/skip_reason) forward onto a new
            // row for the new name, leaving the old row for historical rows
            // (see AccountHeadsDao.createAccountHead for the same pattern on
            // creation).
            await db.sequelize.query(`
                INSERT IGNORE INTO gl_static_ledger_map
                    (location_code, ledger_name, treatment, gl_ledger_id, skip_reason, created_by, updated_by)
                SELECT location_code, :newName, treatment, gl_ledger_id, skip_reason, :updated_by, :updated_by
                FROM gl_static_ledger_map
                WHERE location_code = :location_code AND ledger_name = :oldName
            `, {
                replacements: {
                    newName: data.account_head_name,
                    oldName: existing.account_head_name,
                    location_code: existing.location_code,
                    updated_by: data.updated_by
                },
                type: QueryTypes.INSERT
            });
        }

        return result;
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