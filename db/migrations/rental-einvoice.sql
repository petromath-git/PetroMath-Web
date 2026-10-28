-- ============================================================================
-- Rental invoices: e-invoice (IRN) support — tkt #35
--
-- MC creates e-invoices by hand on einvoice1.gst.gov.in. PetroMath now builds the
-- bulk-upload JSON for the month's B2B rent invoices and imports the portal's
-- result file (IRN, Ack No/Date, signed QR) so the invoice PDF prints them.
--
-- 1. City + PIN (the e-invoice schema needs them apart from the address) on the
--    landlord settings and the tenant, copied onto the invoice when finalised.
-- 2. IRN columns on t_rental_invoice.
-- 3. MC landlord city/PIN; the two known tenants by GSTIN, if they exist.
--
-- Safe to re-run (each ALTER is guarded; ADD COLUMN IF NOT EXISTS isn't MySQL).
-- ============================================================================

DROP PROCEDURE IF EXISTS tmp_add_col;
DELIMITER $$
CREATE PROCEDURE tmp_add_col(IN p_table VARCHAR(64), IN p_col VARCHAR(64), IN p_def VARCHAR(500))
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_col) THEN
        SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_col, ' ', p_def);
        PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

CALL tmp_add_col('m_rental_settings', 'landlord_city',    'VARCHAR(50) NULL AFTER landlord_address');
CALL tmp_add_col('m_rental_settings', 'landlord_pincode', 'VARCHAR(6) NULL AFTER landlord_city');

CALL tmp_add_col('m_rental_tenant', 'city',    'VARCHAR(50) NULL AFTER tenant_address');
CALL tmp_add_col('m_rental_tenant', 'pincode', 'VARCHAR(6) NULL AFTER city');

CALL tmp_add_col('t_rental_invoice', 'tenant_city',       'VARCHAR(50) NULL AFTER tenant_address');
CALL tmp_add_col('t_rental_invoice', 'tenant_pincode',    'VARCHAR(6) NULL AFTER tenant_city');
CALL tmp_add_col('t_rental_invoice', 'irn',               'VARCHAR(64) NULL');
CALL tmp_add_col('t_rental_invoice', 'irn_ack_no',        'VARCHAR(20) NULL');
CALL tmp_add_col('t_rental_invoice', 'irn_ack_date',      'VARCHAR(30) NULL COMMENT ''as given by the IRP''');
CALL tmp_add_col('t_rental_invoice', 'irn_signed_qr',     'TEXT NULL');
CALL tmp_add_col('t_rental_invoice', 'irn_imported_by',   'VARCHAR(45) NULL');
CALL tmp_add_col('t_rental_invoice', 'irn_imported_date', 'TIMESTAMP NULL');

DROP PROCEDURE IF EXISTS tmp_add_col;

-- MC landlord: No 737, Gobi - Dharapuram Road, Kunnathur, Tirupur District. Pin: 638 103.
UPDATE m_rental_settings SET landlord_city = 'Kunnathur', landlord_pincode = '638103'
WHERE location_code = 'MC' AND landlord_city IS NULL;

-- Known tenants (as on the Oct-2026 invoices), only where entered and not yet set
UPDATE m_rental_tenant SET city = 'Coimbatore', pincode = '641041'
WHERE location_code = 'MC' AND gstin = '33AAECP2456L1ZB' AND city IS NULL;
UPDATE m_rental_tenant SET city = 'Kunnathur', pincode = '638103'
WHERE location_code = 'MC' AND gstin = '33AAACP6227D1ZV' AND city IS NULL;

-- Verify
SELECT 'settings city/pin' AS what, CONCAT(landlord_city, ' ', landlord_pincode) AS v FROM m_rental_settings WHERE location_code = 'MC'
UNION ALL SELECT 'irn columns', COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_rental_invoice' AND COLUMN_NAME LIKE 'irn%'
UNION ALL SELECT 'tenants with pin', COUNT(*) FROM m_rental_tenant WHERE location_code = 'MC' AND pincode IS NOT NULL;
