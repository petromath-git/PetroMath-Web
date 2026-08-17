-- ============================================================
-- Fold cashflow types into m_ledger_rules (Static Ledger)
-- Generated: 2026-08-16
--
-- Cashflow types (m_lookup lookup_type='CashFlow') and bank/SOA Static
-- labels (m_ledger_rules) were built independently, years apart, for two
-- separate screens. Both are "a business owner names a category of money
-- movement" — m_ledger_rules already has everything cashflow needs
-- (allowed_entry_type as the credit/debit rule, effective dates for
-- retiring a type, bank_id for the contra case). This migration makes
-- m_ledger_rules the single source of truth going forward.
--
-- m_lookup(CashFlow) is NOT dropped — report DAOs (report-cashflow-dao.js,
-- cashflow-detailed-dao.js) still read it for sort order today; those get
-- migrated separately. This migration only adds the new structures and
-- backfills them; nothing existing is removed.
-- ============================================================

-- ── Step 1: m_ledger_rules — new columns ───────────────────────────────────

ALTER TABLE m_ledger_rules
    ADD COLUMN usable_in_cashflow CHAR(1) NOT NULL DEFAULT 'N' COMMENT 'Y = selectable on the cashflow entry screen',
    ADD COLUMN display_sequence   INT NULL COMMENT 'Sort order for display, replaces m_lookup.attribute1',
    ADD COLUMN is_system_type     CHAR(1) NOT NULL DEFAULT 'N' COMMENT 'Y = seeded by generate_cashflow, cannot be deleted';

-- ── Step 2: t_cashflow_transaction — new column ────────────────────────────
-- No hard FK (matches this codebase's existing convention on gl_ledgers,
-- gl_product_ledger_map etc.) — resolved by application code / triggers.

ALTER TABLE t_cashflow_transaction
    ADD COLUMN ledger_rule_id INT NULL COMMENT 'FK to m_ledger_rules.rule_id — replaces matching type by name';

-- ── Step 3: gl_static_ledger_map — CONTRA support ──────────────────────────
-- Generalizes the table beyond POST/SKIP so a Static label (cashflow-
-- sourced or bank-sourced) can represent "the counterpart is a specific
-- bank account" — the same mechanism gl_cashflow_ledger_map used only for
-- cashflow. Existing POST/SKIP rows are unaffected by this ALTER.

ALTER TABLE gl_static_ledger_map
    MODIFY COLUMN treatment ENUM('POST', 'SKIP', 'CONTRA') NULL,
    ADD COLUMN bank_id INT NULL COMMENT 'Required when treatment=CONTRA — resolves via gl_ledgers.source_type=BANK/source_id=bank_id, same as real bank contras';
