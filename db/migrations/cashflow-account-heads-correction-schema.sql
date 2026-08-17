-- ============================================================
-- Correction: cashflow types belong on m_account_heads, not m_ledger_rules
-- Generated: 2026-08-17
--
-- The previous migration (cashflow-into-ledger-rules-*.sql) inserted
-- cashflow types directly into m_ledger_rules as raw strings — wrong
-- table. The real model, per the actual Accounting Masters screen already
-- in use:
--   m_account_heads = just a ledger name (+ optional gl_group_id sync to
--                     gl_ledgers). No usage rules live here.
--   m_ledger_rules  = the real rules — each row scopes ONE Account Head to
--                     ONE context (a specific bank, OR cashflow — never
--                     both in one row) with that context's own
--                     allowed_entry_type. One Account Head can have
--                     several rule rows, one per context.
--   gl_static_ledger_map = unchanged — still the sole bridge from a label
--                     name to POST/SKIP/CONTRA. The GL engine never reads
--                     m_ledger_rules or m_account_heads for direction or
--                     ledger resolution; it only reads
--                     t_cashflow_transaction (account_head_id + entry_type,
--                     both already resolved before processing time) and
--                     gl_static_ledger_map.
-- ============================================================

-- ── t_cashflow_transaction ──────────────────────────────────────────────────

ALTER TABLE t_cashflow_transaction
    ADD COLUMN account_head_id INT NULL COMMENT 'FK to m_account_heads.account_head_id — replaces ledger_rule_id',
    ADD COLUMN entry_type ENUM('CREDIT', 'DEBIT') NULL COMMENT 'Set at entry time (which section of the cashflow screen); GL engine reads this directly, no lookup';

-- ledger_rule_id pointed at the wrong table entirely — drop it, nothing
-- downstream depends on it (the code using it was never deployed to prod).
ALTER TABLE t_cashflow_transaction DROP COLUMN ledger_rule_id;

-- ── m_ledger_rules ───────────────────────────────────────────────────────────

ALTER TABLE m_ledger_rules
    ADD COLUMN applies_to_cashflow CHAR(1) NOT NULL DEFAULT 'N' COMMENT 'Y = this rule row scopes its Account Head to Cashflow instead of a bank';

-- usable_in_cashflow / is_system_type were added to the wrong table in the
-- earlier migration — is_system_type moves to m_account_heads below;
-- usable_in_cashflow is superseded by applies_to_cashflow (a real rule row,
-- not a flag on every row). display_sequence stays — still useful for
-- ordering the cashflow dropdown.
ALTER TABLE m_ledger_rules
    DROP COLUMN usable_in_cashflow,
    DROP COLUMN is_system_type;

-- ── m_account_heads ──────────────────────────────────────────────────────────

ALTER TABLE m_account_heads
    ADD COLUMN is_system_type CHAR(1) NOT NULL DEFAULT 'N' COMMENT 'Y = seeded by generate_cashflow, cannot be deleted';
