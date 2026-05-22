-- Migration: SHOW_TESTING_SUMMARY config key
-- Purpose: When enabled, the home page product sale columns also show
--          the per-product testing quantity (small secondary line below sale qty).
-- Default: N (disabled). Enable per location.
-- Run on: locations that request the testing summary display.

-- Enable for a specific location (replace 'LOC' with the actual location code):
INSERT INTO m_location_config
    (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
VALUES
    ('LOC', 'SHOW_TESTING_SUMMARY', 'Y', CURDATE(), '9999-12-31', 'MIGRATION', 'MIGRATION', NOW(), NOW())
ON DUPLICATE KEY UPDATE setting_value = 'Y', updated_by = 'MIGRATION', updation_date = NOW();
