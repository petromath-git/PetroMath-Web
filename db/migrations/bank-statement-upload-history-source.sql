-- Add source_screen to t_bank_statement_upload_history so the Bank Reconciliation
-- upload-history view can distinguish uploads made via the Transaction Upload
-- screen from uploads made via Bank Reconciliation's own upload flow — both
-- write to this shared table today with no way to tell them apart.

SET @add_col = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 't_bank_statement_upload_history'
      AND COLUMN_NAME = 'source_screen'
);
SET @sql = IF(@add_col = 0,
    'ALTER TABLE t_bank_statement_upload_history ADD COLUMN source_screen VARCHAR(30) NOT NULL DEFAULT ''BANK_RECON'' AFTER bank_id',
    'SELECT ''source_screen column already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill existing rows: Transaction Upload always stamps remarks with
-- 'retained_file=...' (see saveTransactions in transaction-upload-controller.js);
-- Bank Reconciliation's own remarks pattern is 'Replaced <date> to <date> (...)'
-- or a raw error message. Everything else defaults to BANK_RECON above.
UPDATE t_bank_statement_upload_history
SET source_screen = 'TRANSACTION_UPLOAD'
WHERE remarks LIKE 'retained_file=%'
   OR remarks LIKE 'Partial save%retained_file=%';
