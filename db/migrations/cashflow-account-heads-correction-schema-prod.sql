-- ============================================================
-- Prod-adapted variant of cashflow-account-heads-correction-schema.sql
-- Generated: 2026-08-19
--
-- The original file's DROP COLUMN steps (t_cashflow_transaction.ledger_rule_id,
-- m_ledger_rules.usable_in_cashflow/is_system_type) assume beta's now-superseded
-- FIRST attempt (cashflow-into-ledger-rules-*.sql) was run there first. It never
-- was on prod — verified 2026-08-19, none of those columns exist — so this
-- variant only adds columns, nothing to drop. It also adds
-- m_ledger_rules.display_sequence, which on beta came from that same
-- superseded first-attempt migration and therefore also needs adding fresh
-- here (verified missing on prod).
--
-- Run this INSTEAD OF cashflow-account-heads-correction-schema.sql on prod.
-- ============================================================

-- ── t_cashflow_transaction ──────────────────────────────────────────────────

ALTER TABLE t_cashflow_transaction
    ADD COLUMN account_head_id INT NULL COMMENT 'FK to m_account_heads.account_head_id',
    ADD COLUMN entry_type ENUM('CREDIT', 'DEBIT') NULL COMMENT 'Set at entry time (which section of the cashflow screen); GL engine reads this directly, no lookup';

-- ── m_ledger_rules ───────────────────────────────────────────────────────────

ALTER TABLE m_ledger_rules
    ADD COLUMN applies_to_cashflow CHAR(1) NOT NULL DEFAULT 'N' COMMENT 'Y = this rule row scopes its Account Head to Cashflow instead of a bank',
    ADD COLUMN display_sequence INT NULL COMMENT 'Sort order for display, replaces m_lookup.attribute1';

-- ── m_account_heads ──────────────────────────────────────────────────────────

ALTER TABLE m_account_heads
    ADD COLUMN is_system_type CHAR(1) NOT NULL DEFAULT 'N' COMMENT 'Y = seeded by generate_cashflow, cannot be deleted';
