-- ============================================================
-- Location Config value guard
--
-- Restricts what can be SAVED into m_location_config going forward:
--   1. setting_name must be one of the existing distinct values already
--      in m_location_config (enforced in code for everyone except
--      SuperUser -- see controllers/location-config-controller.js).
--   2. setting_value must match the setting's declared value_type
--      (enforced in code for EVERYONE including SuperUser):
--        - LOOKUP: value must be one of m_lookup.description for the
--          declared lookup_type
--        - NUMBER: value must parse as a number within min_value/max_value
--        - TEXT (default, when no catalog row exists): unrestricted, as today
--
-- This migration only adds metadata (new catalog columns + lookup values +
-- catalog rows for existing settings). It does not change how any
-- consuming controller/dao READS these settings -- see
-- project_poweruser_role_rollout.md memory for the full design writeup.
--
-- Run once per environment. Safe to re-run: idempotent ALTERs (information_
-- schema guarded) and INSERT ... ON DUPLICATE KEY UPDATE throughout.
-- ============================================================

-- 1. New columns on m_location_config_catalog ------------------------------

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'm_location_config_catalog' AND COLUMN_NAME = 'value_type'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE m_location_config_catalog ADD COLUMN value_type ENUM(''TEXT'',''LOOKUP'',''NUMBER'') NOT NULL DEFAULT ''TEXT'' AFTER detailed_description',
    'SELECT ''value_type column already exists'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'm_location_config_catalog' AND COLUMN_NAME = 'lookup_type'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE m_location_config_catalog ADD COLUMN lookup_type VARCHAR(50) NULL AFTER value_type',
    'SELECT ''lookup_type column already exists'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'm_location_config_catalog' AND COLUMN_NAME = 'min_value'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE m_location_config_catalog ADD COLUMN min_value DECIMAL(15,4) NULL AFTER lookup_type',
    'SELECT ''min_value column already exists'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'm_location_config_catalog' AND COLUMN_NAME = 'max_value'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE m_location_config_catalog ADD COLUMN max_value DECIMAL(15,4) NULL AFTER min_value',
    'SELECT ''max_value column already exists'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. New m_lookup lookup_types for the closed-list value families ----------
-- Global (location_code NULL), attribute1 drives display order via the
-- existing lookup-dao.js ordering convention (CAST(IFNULL(attribute1,999))).
-- start_date_active/end_date_active are set explicitly (NOT left NULL) --
-- lookup-dao.js's getLookupByType() filters strictly on this date range, so
-- a NULL value never matches (confirmed: pre-existing ProductMapType lookup
-- rows have NULL dates and are consequently invisible to that method).

INSERT INTO m_lookup (lookup_type, description, tag, attribute1, start_date_active, end_date_active, created_by)
SELECT * FROM (SELECT 'YN_FLAG' AS lookup_type, 'Y' AS description, 'Y' AS tag, '1' AS attribute1, '2020-01-01' AS start_date_active, '2099-12-31' AS end_date_active, 'system' AS created_by
    UNION ALL SELECT 'YN_FLAG', 'N', 'N', '2', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'BOOLEAN_FLAG', 'true', 'true', '1', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'BOOLEAN_FLAG', 'false', 'false', '2', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'LOG_LEVEL', 'DEBUG', 'DEBUG', '1', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'LOG_LEVEL', 'INFO', 'INFO', '2', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'LOG_LEVEL', 'ERROR', 'ERROR', '3', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'BANK_OVERLAP_MODE', 'off', 'off', '1', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'BANK_OVERLAP_MODE', 'warning', 'warning', '2', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'BANK_OVERLAP_MODE', 'strict', 'strict', '3', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'BILL_YEAR_FORMAT', 'YY', 'YY', '1', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'BILL_YEAR_FORMAT', 'YYYY', 'YYYY', '2', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'BILL_RESET_FREQUENCY', 'FINANCIAL_YEAR', 'FINANCIAL_YEAR', '1', '2020-01-01', '2099-12-31', 'system'
    UNION ALL SELECT 'BILL_RESET_FREQUENCY', 'NEVER', 'NEVER', '2', '2020-01-01', '2099-12-31', 'system'
) src
WHERE NOT EXISTS (
    SELECT 1 FROM m_lookup existing
    WHERE existing.lookup_type = src.lookup_type AND existing.description = src.description
);

-- 3. Catalog rows: value_type/lookup_type/min_value/max_value per setting --
-- ON DUPLICATE KEY UPDATE touches ONLY these 4 columns -- existing
-- short_description/detailed_description (from location-config-catalog.sql)
-- are preserved untouched either way.

INSERT INTO m_location_config_catalog (setting_name, value_type, lookup_type, min_value, max_value, created_by, updated_by)
VALUES
-- YN_FLAG (Y/N) -------------------------------------------------------
('ALLOW_BOWSER_REOPEN', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_CASHFLOW_DIGITAL_VENDOR_ADJUSTMENT', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_CREDIT_RECEIPTS_IN_CLOSING', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_DSM_QUICK_ADD_VEHICLE', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_EMPLOYEE_ADVANCE_IN_CLOSING', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_OFF_METER_SALE', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_PAST_DATE_TANK_DIP', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_QUICK_ADD_VEHICLE', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_SHIFT_REOPEN', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_TALLY_EXCLUDE_MASTERS', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_TANK_DIP_DELETE', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('CASHIER_CAN_CREATE_SHIFT_FOR_OTHERS', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('CASHIER_SHIFT_CREATION_ALLOWED', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('CREDIT_STMT_BALANCE_CRDR_FORMAT', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('CREDIT_STMT_SHOW_BALANCE', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('CREDIT_STMT_SHOW_CUSTOMER_INFO', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('CREDIT_STMT_SHOW_PERIOD_SUMMARY', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('CREDIT_STMT_SHOW_STATEMENT_NUMBER', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('EMPLOYEE_AUTO_SALARY', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('ENABLE_CREDIT_REPORT_EXCEL_DOWNLOAD', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('FUEL_INVOICE_EDIT_DISABLED', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('GL_ACCOUNTING_TRIGGER_ENABLED', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('PRODUCT_NAME_EDITABLE', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('PUMP_OPENING_READING_READONLY', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('RECON_CROSS_VENDOR_MATCH', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('SHOW_2T_SALES_TAB', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('SHOW_CASHFLOW_DENOMINATIONS', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('SHOW_DAY_CLOSE_GROUPING', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('SHOW_SKIPPED_READING_DSR', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('SHOW_TESTING_SUMMARY', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),
('SHOW_VEHICLE_BREAKUP', 'LOOKUP', 'YN_FLAG', NULL, NULL, 'system', 'system'),

-- BOOLEAN_FLAG (true/false) -- a DIFFERENT family from YN_FLAG, confirmed by code ---
('ALLOW_BANK_RECLASSIFY', 'LOOKUP', 'BOOLEAN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_BANK_SPLIT', 'LOOKUP', 'BOOLEAN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_MANUAL_BANK_TRANSACTIONS', 'LOOKUP', 'BOOLEAN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_OIL_RECLASSIFY', 'LOOKUP', 'BOOLEAN_FLAG', NULL, NULL, 'system', 'system'),
('ALLOW_SECONDARY_PUMP', 'LOOKUP', 'BOOLEAN_FLAG', NULL, NULL, 'system', 'system'),
('BANK_STATEMENT_EXCLUDE_TODAY', 'LOOKUP', 'BOOLEAN_FLAG', NULL, NULL, 'system', 'system'),
('BILL_INCLUDE_YEAR', 'LOOKUP', 'BOOLEAN_FLAG', NULL, NULL, 'system', 'system'),
('BILL_UNIFIED_SEQUENCE', 'LOOKUP', 'BOOLEAN_FLAG', NULL, NULL, 'system', 'system'),
('CASHFLOW_DSR_STRICT', 'LOOKUP', 'BOOLEAN_FLAG', NULL, NULL, 'system', 'system'),
('CASHFLOW_ENABLED', 'LOOKUP', 'BOOLEAN_FLAG', NULL, NULL, 'system', 'system'),

-- Other small enums -----------------------------------------------------
('GL_LOG_LEVEL', 'LOOKUP', 'LOG_LEVEL', NULL, NULL, 'system', 'system'),
('BANK_STATEMENT_OVERLAP_MODE', 'LOOKUP', 'BANK_OVERLAP_MODE', NULL, NULL, 'system', 'system'),
('BILL_YEAR_FORMAT', 'LOOKUP', 'BILL_YEAR_FORMAT', NULL, NULL, 'system', 'system'),
('BILL_RESET_FREQUENCY', 'LOOKUP', 'BILL_RESET_FREQUENCY', NULL, NULL, 'system', 'system'),

-- NUMBER (non-negative, with sane upper bounds where the code implies one) --
('ADJUSTMENT_MODIFY_MAX_DAYS', 'NUMBER', NULL, 1, 3650, 'system', 'system'),
('BANK_STATEMENT_OVERLAP_DAYS', 'NUMBER', NULL, 0, 30, 'system', 'system'),
('BOWSER_CLOSING_BACKDATE_DAYS', 'NUMBER', NULL, 0, 90, 'system', 'system'),
('CREDIT_RECEIPT_BACKDATE_DAYS', 'NUMBER', NULL, 0, 90, 'system', 'system'),
('DAY_BILL_CONSOLIDATE_THRESHOLD', 'NUMBER', NULL, 0, NULL, 'system', 'system'),
('DEFAULT_CREDIT_DAYS', 'NUMBER', NULL, 0, 365, 'system', 'system'),
('DIGITAL_SALES_BACKDATE_DAYS', 'NUMBER', NULL, 0, 30, 'system', 'system'),
('DIGITAL_SALES_FUTURE_DAYS', 'NUMBER', NULL, 0, 30, 'system', 'system'),
('DOC_MAX_UPLOAD_MB', 'NUMBER', NULL, 0.1, 10, 'system', 'system'),
('EMPLOYEE_LEDGER_BACKDATE_DAYS', 'NUMBER', NULL, 0, 90, 'system', 'system'),
('EMPLOYEE_LEDGER_DELETE_DAYS', 'NUMBER', NULL, 0, 90, 'system', 'system'),
('BILL_NUMBER_PADDING', 'NUMBER', NULL, 1, 10, 'system', 'system'),
('BILL_CASH_START_NUMBER', 'NUMBER', NULL, 0, NULL, 'system', 'system'),
('BILL_CREDIT_START_NUMBER', 'NUMBER', NULL, 0, NULL, 'system', 'system'),
('BILL_UNIFIED_START_NUMBER', 'NUMBER', NULL, 0, NULL, 'system', 'system'),
('MAX_ALLOWED_DRAFTS', 'NUMBER', NULL, 1, 50, 'system', 'system'),
('MAX_ALLOWED_DRAFT_DAYS', 'NUMBER', NULL, 0, 90, 'system', 'system'),
('MAX_CASHFLOW_ROWS', 'NUMBER', NULL, 1, 500, 'system', 'system'),
('MAX_CREDIT_RECEIPTS_ROW_CNT', 'NUMBER', NULL, 1, 500, 'system', 'system'),
('MAX_DECANT_LINES', 'NUMBER', NULL, 1, 20, 'system', 'system'),
('MAX_DAYS_ALLOWED_BACK_DATE_CLOSING', 'NUMBER', NULL, 0, 90, 'system', 'system'),
('RECON_DEFAULT_LOOKBACK_DAYS', 'NUMBER', NULL, 0, 90, 'system', 'system'),
('RECON_MANUAL_MATCH_TOLERANCE', 'NUMBER', NULL, 0, NULL, 'system', 'system'),
('DESKTOP_ZOOM', 'NUMBER', NULL, 0.5, 1.5, 'system', 'system'),
('BILLING_RESTRICT_CASHIER_SHIFT', 'NUMBER', NULL, 0, 1, 'system', 'system'),
('BILLING', 'NUMBER', NULL, 0, 1, 'system', 'system')

ON DUPLICATE KEY UPDATE
    value_type   = VALUES(value_type),
    lookup_type  = VALUES(lookup_type),
    min_value    = VALUES(min_value),
    max_value    = VALUES(max_value),
    updated_by   = VALUES(updated_by),
    updation_date = CURRENT_TIMESTAMP;

-- ============================================================
-- NOT included -- flagging for manual review, not auto-applied:
-- ============================================================
-- ALLOW_BOWSER_REOPEN has one location stored as "true" instead of "Y" --
-- bowser-controller.js:382 checks `=== 'Y'` only, so that location's bowser-
-- reopen permission is silently dead today, independent of this migration.
-- Fix once confirmed with the business owner:
--   UPDATE m_location_config SET setting_value = 'Y'
--   WHERE setting_name = 'ALLOW_BOWSER_REOPEN' AND setting_value = 'true';
--
-- GL_ACCOUNTING_TRIGGER_ENABLED does not match any code/DB-function consumer
-- -- the catalog (location-config-catalog.sql) and the is_gl_accounting_enabled()
-- DB function both reference GL_ACCOUNTING_ENABLED (no "TRIGGER"). Rows
-- stored under the TRIGGER name are likely a typo and may not be doing what
-- whoever set them intended. Confirm before renaming:
--   UPDATE m_location_config SET setting_name = 'GL_ACCOUNTING_ENABLED'
--   WHERE setting_name = 'GL_ACCOUNTING_TRIGGER_ENABLED';
