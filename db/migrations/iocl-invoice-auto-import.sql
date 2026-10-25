-- IOCL invoice auto-import (daily 06:10, one location every 5 minutes) — per-location switch.
-- Default N everywhere. Turn on per location on PROD only; keep N on the beta DB so beta never logs
-- in to IOCL by itself. Also needs IOCL_PORTAL_PULL_ENABLED = Y and a saved portal login.

INSERT INTO m_location_config_catalog
    (setting_name, short_description, detailed_description, value_type, lookup_type, created_by, updated_by)
SELECT 'IOCL_INVOICE_AUTO_IMPORT',
       'IOCL invoice auto-import',
       'Y: every morning from 06:10 PetroMath logs in to IOCL e-Mitra once for this location, fetches the last 7 days of invoices and saves the ones not yet entered as Fuel Invoices (only when the PDF reads cleanly and every product is already mapped; the rest stay in "Fetch from IOCL"). Locations run one at a time, 5 minutes apart. Needs IOCL_PORTAL_PULL_ENABLED = Y and a saved portal login. Keep N on beta.',
       'LOOKUP', 'YN_FLAG', 'system', 'system'
WHERE NOT EXISTS (SELECT 1 FROM m_location_config_catalog WHERE setting_name = 'IOCL_INVOICE_AUTO_IMPORT');

INSERT INTO m_location_config
    (location_code, setting_name, setting_value, effective_start_date, effective_end_date,
     created_by, updated_by, creation_date, updation_date)
SELECT '*', 'IOCL_INVOICE_AUTO_IMPORT', 'N', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM m_location_config
                  WHERE location_code = '*' AND setting_name = 'IOCL_INVOICE_AUTO_IMPORT');

-- Prod only, per location, e.g.:
-- INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
-- VALUES ('MUE', 'IOCL_INVOICE_AUTO_IMPORT', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW());

SELECT location_code, setting_name, setting_value FROM m_location_config WHERE setting_name = 'IOCL_INVOICE_AUTO_IMPORT';
