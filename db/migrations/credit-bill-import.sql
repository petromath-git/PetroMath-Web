-- Credit bill import (shift closing > Credit Sales > Import bills).
-- Remembers how names in a billing-system export map to PetroMath customers and products,
-- so the import asks only once per name. Gated per location by CREDIT_BILL_IMPORT.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS t_credit_import_map (
    id             INT          NOT NULL AUTO_INCREMENT,
    location_code  VARCHAR(20)  NOT NULL,
    map_type       VARCHAR(10)  NOT NULL,          -- 'PARTY' -> m_credit_list.creditlist_id, 'PRODUCT' -> m_product.product_id
    source_name    VARCHAR(200) NOT NULL,          -- name as it appears in the file, upper-cased, single-spaced
    target_id      INT          NOT NULL,
    created_by     VARCHAR(45)  NULL,
    updated_by     VARCHAR(45)  NULL,
    creation_date  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_credit_import_map (location_code, map_type, source_name)
);

INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, created_by, updated_by)
VALUES ('CREDIT_BILL_IMPORT', 'Import credit bills from billing-system Excel',
 'Y/N. Shows an "Import bills" button on the shift closing Credit Sales tab. Reads an Excel export (B.No, Date, Type, Vehicle, Party, GSTIN, Indent, Item, Qty, Rate, Amount), maps party and product names once (remembered in t_credit_import_map), creates missing customers and vehicles, skips bill numbers already in the location, and rejects the whole file if a bill date is outside the closing window or a rate differs from the shift rate. Default disabled.',
 'system', 'system')
ON DUPLICATE KEY UPDATE short_description = VALUES(short_description), detailed_description = VALUES(detailed_description);

-- Enable for HAR
INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
SELECT 'HAR', 'CREDIT_BILL_IMPORT', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM m_location_config WHERE location_code = 'HAR' AND setting_name = 'CREDIT_BILL_IMPORT');
