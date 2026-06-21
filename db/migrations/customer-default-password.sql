-- Per-location default password for customer portal login.
-- Used as the reset password AND as the universal debug password (replaces hardcoded petromath123).
-- Set a unique value per location. SuperUser can log into any customer account using this password.
-- Change the value for each location as needed.

INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date)
VALUES
    -- Global fallback — applies to any location that doesn't have its own entry
    ('*', 'CUSTOMER_DEFAULT_PASSWORD', 'welcome123', '2024-01-01', '2099-12-31')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- To set a location-specific password (overrides the global default for that location):
-- INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date)
-- VALUES ('MUE', 'CUSTOMER_DEFAULT_PASSWORD', 'your-password-here', '2024-01-01', '2099-12-31')
-- ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
