-- ============================================================
-- Credit Receipts in Shift Closing: schema groundwork
--
-- Adds closing_id to t_receipts so a credit receipt (cash or
-- digital) entered from the shift-closing "Collections" tab can
-- be tied to the shift that recorded it. Nullable: rows created
-- via the standalone /creditreceipts admin page are unaffected
-- and keep closing_id = NULL.
--
-- Also creates t_receipts_deleted, the recycle-bin counterpart
-- used by delete_closing/restore_closing (see
-- add-receipts-to-delete-closing.sql and
-- add-receipts-to-restore-closing.sql), mirroring the shape of
-- t_credits_deleted / t_digital_sales_deleted.
--
-- Safe to re-run: uses IF NOT EXISTS guards throughout.
-- ============================================================

ALTER TABLE t_receipts
    ADD COLUMN IF NOT EXISTS closing_id INT NULL
        COMMENT 'FK to t_closing.closing_id; NULL for receipts entered outside a shift (admin Credit Receipts page).',
    ADD INDEX IF NOT EXISTS idx_receipts_closing_id (closing_id);

CREATE TABLE IF NOT EXISTS t_receipts_deleted (
    treceipt_id             INT           NOT NULL,
    receipt_no              INT           NULL,
    creditlist_id           INT           NULL,
    digital_creditlist_id   INT           NULL,
    receipt_type            VARCHAR(45)   NULL,
    amount                  DECIMAL(20,3) NULL,
    notes                   VARCHAR(500)  NULL,
    location_code           VARCHAR(50)   NULL,
    closing_id              INT           NULL,
    created_by              VARCHAR(45)   NULL,
    updated_by              VARCHAR(45)   NULL,
    creation_date           DATETIME      NULL,
    updation_date           DATETIME      NULL,
    receipt_date            DATETIME      NULL,
    cashflow_date           DATETIME      NULL,
    pending_cashflow_id     INT           NULL,
    recon_match_id          BIGINT        NULL,
    manual_recon_flag       TINYINT       NULL DEFAULT 0,
    manual_recon_by         VARCHAR(50)   NULL,
    manual_recon_date       DATETIME      NULL,
    source_txn_id           INT           NULL,
    source_split_id         INT           NULL,
    deleted_by               VARCHAR(45)   NULL,
    deleted_at                DATETIME      NULL,
    PRIMARY KEY (treceipt_id),
    KEY idx_receipts_deleted_closing_id (closing_id)
);
