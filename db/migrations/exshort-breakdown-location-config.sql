-- ============================================================
-- SHOW_EXSHORT_BREAKDOWN — per-location gate for the excess/shortage
-- breakdown popup (link on the shift list and on the closing Summary tab).
-- 'Y' = show the link, anything else / not set = hidden (default 'N').
--
-- Enable for a location by inserting a row for it, e.g. replace
-- '<LOCATION_CODE>' below. Use '*' as location_code to enable everywhere.
-- ============================================================

INSERT INTO m_location_config
    (location_code, setting_name, setting_value, effective_start_date, effective_end_date,
     created_by, updated_by, creation_date, updation_date)
VALUES
    ('<LOCATION_CODE>', 'SHOW_EXSHORT_BREAKDOWN', 'Y', CURDATE(), '9999-12-31',
     'system', 'system', NOW(), NOW());
