-- GST Returns: reverse charge self-invoices (/gst/rcm) only where a location needs them.
-- GST_RCM_SELF_INVOICE = Y shows the Reverse charge step and puts its self-invoices into
-- GSTR-1 Table 13 and GSTR-3B 3.1(d) / 4A(3) / 6.1(B). N hides it and leaves them out.
-- Reverse charge lines in the uploaded GSTR-2B count either way.
-- Default N for every location; set Y on the Location Config screen where rent is paid under reverse charge.
-- Safe to run twice.

INSERT INTO m_location_config_catalog
    (setting_name, short_description, detailed_description, value_type, lookup_type, created_by, updated_by)
VALUES
    ('GST_RCM_SELF_INVOICE',
     'GST Returns: reverse charge self-invoices (rent)',
     'Y = GST Returns shows the Reverse charge step, where rent paid to a landlord without GST registration is entered as a self-invoice each month; it goes into GSTR-1 Table 13 and GSTR-3B 3.1(d), 4A(3) and 6.1. N = the step is hidden and no self-invoices are used. Reverse charge lines in the uploaded GSTR-2B count either way.',
     'LOOKUP', 'YN_FLAG', 'system', 'system')
ON DUPLICATE KEY UPDATE
    short_description = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    value_type = VALUES(value_type),
    lookup_type = VALUES(lookup_type),
    updated_by = 'system';

INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
SELECT v.location_code, 'GST_RCM_SELF_INVOICE', v.setting_value, CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
FROM (SELECT '*' AS location_code, 'N' AS setting_value) v
WHERE NOT EXISTS (SELECT 1 FROM m_location_config c
                  WHERE c.setting_name = 'GST_RCM_SELF_INVOICE' AND c.location_code = v.location_code);

-- Check
SELECT config_id, location_code, setting_value FROM m_location_config WHERE setting_name = 'GST_RCM_SELF_INVOICE' ORDER BY location_code;
