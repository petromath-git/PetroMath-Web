-- Config: CUSTOMER_OPENING_ADVANCE
--
-- Customer Master's opening balance takes only "Amount customer owes".
-- With CUSTOMER_OPENING_ADVANCE = Y a location also gets an
-- "Advance / security deposit" field (stored as the same Opening Balance
-- Entry, on the credit side) and can change existing advance openings.
-- Default (no row) = N: advance openings show read-only.
--
-- Enabled for SFS, which keeps customer security deposits. Add a row for any
-- other location that asks for it.

INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
SELECT 'SFS', 'CUSTOMER_OPENING_ADVANCE', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM m_location_config
                  WHERE location_code = 'SFS' AND setting_name = 'CUSTOMER_OPENING_ADVANCE');

SELECT location_code, setting_name, setting_value, effective_start_date, effective_end_date
FROM   m_location_config
WHERE  setting_name = 'CUSTOMER_OPENING_ADVANCE';
