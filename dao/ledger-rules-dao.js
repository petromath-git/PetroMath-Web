// dao/ledger-rules-dao.js
// Static rules  → fully managed here (create / update all fields / delete).
// Credit/Supplier rules → created by DB triggers; only allowed_entry_type is editable here.
const db = require("../db/db-connection");
const { QueryTypes } = require("sequelize");

// Builds the bank display label: "SBI (...1234)" or just "SBI" when no account number.
const BANK_DISPLAY = `
    CASE
        WHEN b.account_number IS NOT NULL AND b.account_number != ''
        THEN CONCAT(b.bank_name, ' (...', RIGHT(b.account_number, 4), ')')
        ELSE b.bank_name
    END
`;

module.exports = {

    // All rules for the location — Static + Credit + Supplier + Bank.
    getAllRules: async (locationCode) => {
        const query = `
            SELECT
                r.rule_id,
                r.source_type,
                r.bank_id,
                ${BANK_DISPLAY}          AS bank_display,
                r.external_id,
                CASE
                    WHEN r.source_type = 'Bank' THEN mb2.ledger_name
                    ELSE r.ledger_name
                END                      AS ledger_name,
                r.allowed_entry_type,
                r.notes_required_flag,
                r.max_amount,
                r.effective_start_date,
                r.effective_end_date,
                r.allow_split_flag,
                r.created_by,
                r.updated_by
            FROM m_ledger_rules r
            INNER JOIN m_bank b  ON b.bank_id  = r.bank_id
            LEFT  JOIN m_bank mb2
                ON  r.source_type  = 'Bank'
                AND r.external_id  = mb2.bank_id
            WHERE r.location_code = :locationCode
            ORDER BY r.source_type, b.bank_name,
                     CASE WHEN r.source_type = 'Bank' THEN mb2.ledger_name ELSE r.ledger_name END
        `;
        return await db.sequelize.query(query, {
            replacements: { locationCode },
            type: QueryTypes.SELECT
        });
    },

    // ── Static rule CRUD ────────────────────────────────────────────────────

    createStaticRule: async (data) => {
        const query = `
            INSERT INTO m_ledger_rules (
                location_code, bank_id, source_type, external_id,
                ledger_name, allowed_entry_type, notes_required_flag,
                max_amount, effective_start_date, effective_end_date,
                allow_split_flag, created_by
            ) VALUES (
                :location_code, :bank_id, 'Static', :external_id,
                :ledger_name, :allowed_entry_type, :notes_required_flag,
                :max_amount, :effective_start_date, :effective_end_date,
                :allow_split_flag, :created_by
            )
        `;
        return await db.sequelize.query(query, {
            replacements: data,
            type: QueryTypes.INSERT
        });
    },

    updateStaticRule: async (data) => {
        const query = `
            UPDATE m_ledger_rules
            SET
                bank_id              = :bank_id,
                external_id          = :external_id,
                ledger_name          = :ledger_name,
                allowed_entry_type   = :allowed_entry_type,
                notes_required_flag  = :notes_required_flag,
                max_amount           = :max_amount,
                effective_start_date = :effective_start_date,
                effective_end_date   = :effective_end_date,
                allow_split_flag     = :allow_split_flag,
                updated_by           = :updated_by,
                updation_date        = NOW()
            WHERE rule_id = :rule_id
              AND source_type = 'Static'
        `;
        return await db.sequelize.query(query, {
            replacements: data,
            type: QueryTypes.UPDATE
        });
    },

    deleteStaticRule: async (id) => {
        const query = `
            DELETE FROM m_ledger_rules
            WHERE rule_id = :id
              AND source_type = 'Static'
        `;
        return await db.sequelize.query(query, {
            replacements: { id },
            type: QueryTypes.DELETE
        });
    },

    // ── Allow Split flag — editable on all rule types ───────────────────────

    updateSplitFlag: async ({ rule_id, allow_split_flag, updated_by }) => {
        const query = `
            UPDATE m_ledger_rules
            SET allow_split_flag = :allow_split_flag,
                updated_by       = :updated_by,
                updation_date    = NOW()
            WHERE rule_id = :rule_id
        `;
        return await db.sequelize.query(query, {
            replacements: { rule_id, allow_split_flag, updated_by },
            type: QueryTypes.UPDATE
        });
    },

    // ── Credit / Supplier — entry type override only ────────────────────────

    updateEntryType: async ({ rule_id, allowed_entry_type, updated_by }) => {
        const query = `
            UPDATE m_ledger_rules
            SET
                allowed_entry_type = :allowed_entry_type,
                updated_by         = :updated_by,
                updation_date      = NOW()
            WHERE rule_id    = :rule_id
              AND source_type != 'Static'
        `;
        return await db.sequelize.query(query, {
            replacements: { rule_id, allowed_entry_type, updated_by },
            type: QueryTypes.UPDATE
        });
    }
};
