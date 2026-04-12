-- ============================================================================
-- bank-transaction-splits.sql
-- ============================================================================
-- Purpose:
--   Adds split-transaction support to the bank statement module.
--
--   1. m_ledger_rules  → add allow_split_flag (controls which ledgers may
--                         appear as split targets, e.g. Paytm = 'N')
--   2. m_bank_allowed_ledgers_v → recreate to expose allow_split_flag
--   3. t_bank_transaction → add is_split flag
--   4. t_bank_transaction_splits → new child table for split allocations
--
-- Design contract:
--   • A parent t_bank_transaction row is the raw bank line (full amount).
--   • When is_split = 'Y', classification and receipt creation come from
--     t_bank_transaction_splits rows instead of the parent.
--   • SUM(splits.amount) must equal the parent credit_amount (or debit_amount).
--   • allow_split_flag = 'N' on a ledger rule prevents that ledger from
--     appearing in the split modal dropdown, enforced in both UI and API.
--
-- Safe to re-run:
--   ALTER TABLE ... ADD COLUMN uses IF NOT EXISTS guard (MySQL 8+).
--   CREATE TABLE uses IF NOT EXISTS.
--   CREATE OR REPLACE VIEW is idempotent.
-- ============================================================================


-- ── 0. Location config key: ALLOW_BANK_SPLIT ─────────────────────────────────
--    Controls whether the split transaction UI is shown on the bank statement
--    page.  Disabled by default — must be explicitly enabled per location.
--    Insert the row below for each location that should have split enabled:
--
--      INSERT INTO m_location_config (location_code, config_name, config_value)
--      VALUES ('SFS', 'ALLOW_BANK_SPLIT', 'true')
--      ON DUPLICATE KEY UPDATE config_value = 'true';
--
--    To enable globally across all locations:
--      INSERT INTO m_location_config (location_code, config_name, config_value)
--      VALUES ('*', 'ALLOW_BANK_SPLIT', 'true')
--      ON DUPLICATE KEY UPDATE config_value = 'true';
-- ────────────────────────────────────────────────────────────────────────────


-- ── 1. Add allow_split_flag to m_ledger_rules ────────────────────────────────
--    Default 'N' — no ledger is split-eligible unless explicitly set to 'Y'.
--    Enable splitting for specific ledgers (e.g. Credit customers) as needed:
--
--      UPDATE m_ledger_rules SET allow_split_flag = 'Y'
--      WHERE source_type = 'Credit';
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE m_ledger_rules
    ADD COLUMN IF NOT EXISTS allow_split_flag CHAR(1) NOT NULL DEFAULT 'N';


-- ── 2. Recreate m_bank_allowed_ledgers_v to expose allow_split_flag ──────────
--    Mirrors the structure from bank-ledger-list-update.sql exactly, with
--    allow_split_flag added as an additional projected column.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW m_bank_allowed_ledgers_v AS
SELECT
    lr.rule_id,
    lr.location_code,
    lr.bank_id,
    lr.source_type,
    lr.external_id,
    lr.allowed_entry_type,
    lr.notes_required_flag,
    lr.max_amount,
    lr.allow_split_flag,
    CASE
        WHEN lr.source_type = 'Supplier' THEN ms.supplier_name
        WHEN lr.source_type = 'Credit'   THEN mcl.Company_Name
        WHEN lr.source_type = 'Static'   THEN lr.ledger_name
        WHEN lr.source_type = 'Bank'     THEN mb2.ledger_name
    END AS ledger_name,
    CASE
        WHEN lr.source_type = 'Supplier' THEN ms.supplier_short_name
        WHEN lr.source_type = 'Credit'   THEN mcl.Company_Name
        WHEN lr.source_type = 'Static'   THEN lr.ledger_name
        WHEN lr.source_type = 'Bank'     THEN
            CONCAT(mb2.bank_name,
                   IF(mb2.account_nickname IS NOT NULL AND mb2.account_nickname != '',
                      CONCAT(' (', mb2.account_nickname, ')'), ''))
    END AS ledger_display_name
FROM m_ledger_rules lr
LEFT JOIN m_supplier ms
    ON  lr.source_type = 'Supplier'
    AND lr.external_id = ms.supplier_id
    AND COALESCE(ms.effective_end_date, '9999-12-31') > CURDATE()
LEFT JOIN m_credit_list mcl
    ON  lr.source_type = 'Credit'
    AND lr.external_id = mcl.creditlist_id
    AND COALESCE(mcl.effective_end_date, '9999-12-31') > CURDATE()
LEFT JOIN m_bank mb2
    ON  lr.source_type = 'Bank'
    AND lr.external_id = mb2.bank_id
    AND mb2.active_flag = 'Y'
WHERE lr.source_type = 'Static'
   OR (lr.source_type = 'Supplier' AND ms.supplier_id    IS NOT NULL)
   OR (lr.source_type = 'Credit'   AND mcl.creditlist_id IS NOT NULL)
   OR (lr.source_type = 'Bank'     AND mb2.bank_id       IS NOT NULL)
ORDER BY source_type, ledger_display_name;


-- ── 3. Add is_split to t_bank_transaction ────────────────────────────────────
--    'Y' = this row has been split into child rows in t_bank_transaction_splits.
--    When is_split = 'Y': ledger_name / external_id / external_source on the
--    parent are irrelevant — use the splits table instead.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE t_bank_transaction
    ADD COLUMN IF NOT EXISTS is_split CHAR(1) NOT NULL DEFAULT 'N';


-- ── 4. Add source_split_id to t_receipts ─────────────────────────────────────
--    Allows precise per-split dedup in the after_cashflow_close trigger and
--    clean deletion when a split is removed.
--    NULL  = receipt was NOT created from a split row (existing rows unaffected).
--    INT   = split_id of the t_bank_transaction_splits row that created it.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE t_receipts
    ADD COLUMN IF NOT EXISTS source_split_id INT NULL
        COMMENT 'FK to t_bank_transaction_splits.split_id; NULL for non-split receipts.',
    ADD KEY IF NOT EXISTS idx_receipts_source_split_id (source_split_id);


-- ── 5. Create t_bank_transaction_splits ──────────────────────────────────────
--    One row per ledger allocation within a split transaction.
--    amount values must sum to the parent's credit_amount (or debit_amount).
--    Receipts auto-created for Credit splits carry source_txn_id = t_bank_id
--    (same parent FK used by all other receipt creation paths).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS t_bank_transaction_splits (
    split_id        INT           NOT NULL AUTO_INCREMENT,
    t_bank_id       INT           NOT NULL,
    amount          DECIMAL(12,2) NOT NULL,
    ledger_name     VARCHAR(100)  NOT NULL,
    external_id     INT               NULL,
    external_source VARCHAR(50)       NULL,
    remarks         VARCHAR(255)      NULL,
    created_by      VARCHAR(50)       NULL,
    creation_date   DATETIME      NOT NULL DEFAULT NOW(),

    PRIMARY KEY (split_id),
    CONSTRAINT fk_split_txn FOREIGN KEY (t_bank_id)
        REFERENCES t_bank_transaction (t_bank_id)
        ON DELETE CASCADE
);


-- ── 5. v_bank_txn_classified — unified view for tally export & reports ───────
--    Callers that previously read FROM t_bank_transaction for ledger/amount
--    classification should use this view instead.  It presents:
--      • Non-split rows exactly as they appear in t_bank_transaction (is_split = 'N')
--      • Split rows expanded — one row per t_bank_transaction_splits child,
--        inheriting the parent's date / bank / transaction_type / closed_flag
--        but using the child's amount, ledger_name, and external_source.
--
--    Usage in stored procedures (e.g. tally_export_v2):
--      Replace:  FROM t_bank_transaction tbt
--      With:     FROM v_bank_txn_classified tbt
--    for the BANK DEBIT and BANK CREDIT cursors.  All other cursor filters
--    (closed_flag, external_source, location_code, date range) remain unchanged.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_bank_txn_classified AS
-- ── Non-split rows: pass through unchanged ───────────────────────────────────
SELECT
    tbt.t_bank_id,
    tbt.trans_date,
    tbt.bank_id,
    tbt.transaction_type,
    tbt.debit_amount,
    tbt.credit_amount,
    tbt.ledger_name,
    tbt.external_source,
    tbt.remarks,
    tbt.closed_flag
FROM t_bank_transaction tbt
WHERE IFNULL(tbt.is_split, 'N') = 'N'

UNION ALL

-- ── Split rows: one row per split child, parent metadata inherited ────────────
SELECT
    tbt.t_bank_id,
    tbt.trans_date,
    tbt.bank_id,
    tbt.transaction_type,
    CASE WHEN tbt.debit_amount  > 0 THEN s.amount ELSE NULL END AS debit_amount,
    CASE WHEN tbt.credit_amount > 0 THEN s.amount ELSE NULL END AS credit_amount,
    s.ledger_name,
    s.external_source,
    CONCAT(
        IFNULL(tbt.remarks, ''),
        CASE WHEN s.remarks IS NOT NULL AND s.remarks != ''
             THEN CONCAT(' - ', s.remarks) ELSE '' END
    ) AS remarks,
    tbt.closed_flag
FROM t_bank_transaction tbt
JOIN t_bank_transaction_splits s ON s.t_bank_id = tbt.t_bank_id
WHERE tbt.is_split = 'Y';


-- ── Verify ───────────────────────────────────────────────────────────────────
-- Confirm allow_split_flag column exists
SELECT COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'm_ledger_rules'
  AND COLUMN_NAME  = 'allow_split_flag';

-- Confirm is_split column exists
SELECT COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 't_bank_transaction'
  AND COLUMN_NAME  = 'is_split';

-- Confirm splits table exists
SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 't_bank_transaction_splits';
