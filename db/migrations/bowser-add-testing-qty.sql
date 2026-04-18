-- Add testing_qty to t_bowser_closing
-- Testing quantity is fuel used for calibration/testing, deducted from meter diff before sales reconciliation.
SET @dbname = DATABASE();
SET @colname = 'testing_qty';
SET @tblname = 't_bowser_closing';

SET @sql = IF(
    NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tblname AND COLUMN_NAME = @colname
    ),
    CONCAT('ALTER TABLE ', @tblname, ' ADD COLUMN testing_qty DECIMAL(10,3) NOT NULL DEFAULT 0 COMMENT ''Fuel used for testing/calibration'' AFTER closing_meter'),
    'SELECT ''Column already exists, skipping.'' AS status'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'bowser-add-testing-qty migration done.' AS status;
