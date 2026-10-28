-- Credit bill import for RAN (Partum billing export).
-- Adds CREDIT_BILL_IMPORT_CASHIER: when Y the file must name the cashier (Partum's
-- cashier-wise export has a "CASHIER: NAME" title line), and only
-- the bills of the shift's cashier are imported. Cashier names are remembered in
-- t_credit_import_map (map_type 'CASHIER' -> m_persons.Person_id). Digital vendors
-- (PAYTM, FLEET CARD) need no setting: their bills go to t_digital_sales.
-- Needs credit-bill-import.sql first. Safe to re-run.

INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, created_by, updated_by)
VALUES ('CREDIT_BILL_IMPORT_CASHIER', 'Credit bill import: file must have the cashier',
 'Y/N. With CREDIT_BILL_IMPORT on, rejects a file that does not name the cashier (a "CASHIER: NAME" title line or a Cashier column). Each cashier name is matched to a staff member once, and only the bills of the shift''s cashier are imported (other cashiers'' bills are ignored). Without this setting a Cashier column, if present, is still used. Default N.',
 'system', 'system')
ON DUPLICATE KEY UPDATE short_description = VALUES(short_description), detailed_description = VALUES(detailed_description);

-- Enable the import for RAN
INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
SELECT 'RAN', 'CREDIT_BILL_IMPORT', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM m_location_config WHERE location_code = 'RAN' AND setting_name = 'CREDIT_BILL_IMPORT');

-- RAN exports one file per cashier: reject files that do not name the cashier
INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
SELECT 'RAN', 'CREDIT_BILL_IMPORT_CASHIER', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM m_location_config WHERE location_code = 'RAN' AND setting_name = 'CREDIT_BILL_IMPORT_CASHIER');
