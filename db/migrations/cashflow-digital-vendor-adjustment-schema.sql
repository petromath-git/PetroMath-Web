-- ============================================================
-- Cashflow -> Auto Digital-Vendor Debit Adjustment: schema
-- Generated: 2026-09-03
--
-- Lets a cashflow Outflow row (e.g. "customer paid via Paytm, we
-- gave them cash") automatically create/sync the matching debit
-- adjustment against the digital vendor's ledger, instead of the
-- cashier having to create it by hand on the Adjustments screen.
--
-- Additive only. Plain ADD COLUMN/ADD INDEX (no IF NOT EXISTS -
-- this server rejects that syntax on ALTER TABLE).
-- ============================================================

ALTER TABLE m_account_heads
    ADD COLUMN requires_digital_vendor_link CHAR(1) NOT NULL DEFAULT 'N'
        COMMENT 'Y = selecting this head in Cashflow shows a digital-vendor picker and auto-creates a linked t_adjustments debit';

ALTER TABLE t_cashflow_transaction
    ADD COLUMN digital_vendor_id INT NULL
        COMMENT 'creditlist_id - only set when account_head_id.requires_digital_vendor_link=Y; drives the auto-created t_adjustments row';

ALTER TABLE t_adjustments
    ADD COLUMN source_table VARCHAR(30) NULL
        COMMENT 'e.g. t_cashflow_transaction - NULL for manually-entered adjustments',
    ADD COLUMN source_id INT NULL
        COMMENT 'PK value in source_table',
    ADD INDEX idx_adjustments_source (source_table, source_id);
