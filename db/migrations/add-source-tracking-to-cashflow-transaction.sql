-- ============================================================
-- t_cashflow_transaction: add source_table/source_id
--
-- generate_cashflow's Cash Receipt and Salary Payout/Recovery
-- entries were only ever matchable back to their originating
-- t_receipts/t_employee_ledger row by reconstructing the exact
-- description string it built at insert time - there was no FK.
-- That fragility already caused one bug (reopenShift's cashflow
-- cleanup silently failing to find its match).
--
-- Nullable: aggregate entry types (Balance B/F, Collection,
-- Cashier A/C, Discount, 2T Oil, Expense) are day-level sums, not
-- single-row sources, and stay NULL - only Cash Receipt and Salary
-- Payout/Recovery entries populate these (see
-- add-source-tracking-to-generate-cashflow.sql).
--
-- Safe to re-run: uses IF NOT EXISTS guards.
-- ============================================================

ALTER TABLE t_cashflow_transaction
    ADD COLUMN IF NOT EXISTS source_table VARCHAR(30) NULL
        COMMENT 'e.g. t_receipts, t_employee_ledger - NULL for aggregate/summary entry types',
    ADD COLUMN IF NOT EXISTS source_id INT NULL
        COMMENT 'PK value in source_table (treceipt_id / ledger_id)',
    ADD INDEX IF NOT EXISTS idx_cashflow_txn_source (source_table, source_id);
