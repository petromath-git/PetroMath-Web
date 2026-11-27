-- ============================================================
-- tkt #496: Name of the person doing the Day Close.
--
-- Several people share one login at some bunks, so the login user
-- does not say who actually closed the day. When the location sets
-- DAY_CLOSE_CAPTURE_CLOSER_NAME = Y, the Day Close page asks for a
-- free-text "Day closed by" name before CLOSE. It is stored in
-- t_cashflow_closing.closed_by_name (upper case) and shown on the
-- Day Close Report (DSR). Reopen clears it, so the next close asks again.
--
-- Default '*' = N; enabled for PAC. Safe to re-run.
-- ============================================================

-- 1. Column (guarded: ADD COLUMN IF NOT EXISTS isn't supported on MySQL)
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 't_cashflow_closing'
                      AND COLUMN_NAME = 'closed_by_name');
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE t_cashflow_closing ADD COLUMN closed_by_name VARCHAR(100) NULL AFTER notes',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Catalog row
INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, value_type, lookup_type, created_by, updated_by)
VALUES
('DAY_CLOSE_CAPTURE_CLOSER_NAME', 'Ask for the name of the person doing Day Close',
 'Y/N. When Y, the Day Close page shows a required "Day closed by" text box next to CLOSE (for bunks where several people share one login). The name is saved in upper case and printed on the Day Close Report. Reopening the day clears it. Default N. Checked in cash-flow-controller.js.',
 'LOOKUP', 'YN_FLAG', 'system', 'system')
ON DUPLICATE KEY UPDATE
    short_description    = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    value_type           = VALUES(value_type),
    lookup_type          = VALUES(lookup_type),
    updated_by           = 'system';

-- 3. Global default N (guarded: m_location_config has no unique key)
INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
SELECT '*', 'DAY_CLOSE_CAPTURE_CLOSER_NAME', 'N', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_location_config WHERE setting_name = 'DAY_CLOSE_CAPTURE_CLOSER_NAME' AND location_code = '*');

-- 4. Enable for PAC
INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
SELECT 'PAC', 'DAY_CLOSE_CAPTURE_CLOSER_NAME', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_location_config WHERE setting_name = 'DAY_CLOSE_CAPTURE_CLOSER_NAME' AND location_code = 'PAC');
