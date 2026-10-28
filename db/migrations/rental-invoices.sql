-- ============================================================================
-- Rental Invoices (/rental) — tkt #35
--
-- MC's GSTIN is the proprietor's own GSTIN, so the rent he charges his tenants
-- is taxable under that GSTIN and belongs in MC's GST returns and MC's books.
--
-- 1. m_rental_settings  — one row per location: landlord details printed on the
--                          invoice, bank details, running invoice number, the
--                          bank rent is paid into, income / TDS ledgers.
-- 2. m_rental_tenant    — tenant master. Each tenant gets its own GL ledger
--                          (source_type TENANT) under Sundry Debtors.
-- 3. t_rental_invoice   — monthly invoices. DRAFT has no number; FINAL takes the
--                          next running number and is never edited (cancel and
--                          reissue instead).
-- 4. gl_ledgers.source_type gets 'TENANT'.
-- 5. MC: "RENT RECEIVED" (Indirect Incomes) and "TDS RECEIVABLE" (Current
--    Assets) ledgers, and the settings row with the landlord details.
-- 6. Menu RENTAL_INVOICES under Accounting, granted to MC only.
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS m_rental_settings (
    location_code       VARCHAR(50)   NOT NULL,
    landlord_name       VARCHAR(200)  NOT NULL,
    landlord_address    VARCHAR(500)  NULL,
    gstin               VARCHAR(15)   NULL,
    pan                 VARCHAR(10)   NULL,
    bank_name           VARCHAR(100)  NULL,
    bank_branch         VARCHAR(100)  NULL,
    bank_ifsc           VARCHAR(20)   NULL,
    bank_account_no     VARCHAR(30)   NULL,
    rent_bank_id        INT           NULL COMMENT 'm_bank the rent is paid into; tenant receipt rules are created on it',
    last_invoice_no     INT           NOT NULL DEFAULT 0 COMMENT 'running number, never resets',
    invoice_day         TINYINT       NOT NULL DEFAULT 26,
    income_ledger_id    INT           NULL,
    tds_ledger_id       INT           NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (location_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m_rental_tenant (
    tenant_id           INT           NOT NULL AUTO_INCREMENT,
    location_code       VARCHAR(50)   NOT NULL,
    tenant_name         VARCHAR(200)  NOT NULL,
    tenant_address      VARCHAR(500)  NULL,
    gstin               VARCHAR(15)   NULL,
    phone               VARCHAR(50)   NULL,
    email               VARCHAR(100)  NULL,
    property_address    VARCHAR(500)  NULL COMMENT 'printed as Place of Supply',
    rent_description    VARCHAR(200)  NOT NULL DEFAULT 'BUILDING RENT',
    sac_code            VARCHAR(10)   NOT NULL DEFAULT '997212',
    monthly_rent        DECIMAL(12,2) NOT NULL,
    gst_rate            DECIMAL(5,2)  NOT NULL DEFAULT 18.00,
    tds_percent         DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
    start_date          DATE          NOT NULL,
    end_date            DATE          NULL,
    ledger_id           INT           NULL,
    notes               VARCHAR(500)  NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id),
    UNIQUE KEY uniq_rental_tenant_name (location_code, tenant_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tenant name/address/GSTIN are copied onto the invoice when it is finalised, so
-- a later master edit never changes an invoice that was already issued.
CREATE TABLE IF NOT EXISTS t_rental_invoice (
    invoice_id          INT           NOT NULL AUTO_INCREMENT,
    location_code       VARCHAR(50)   NOT NULL,
    tenant_id           INT           NOT NULL,
    invoice_no          INT           NULL COMMENT 'NULL while DRAFT',
    invoice_date        DATE          NOT NULL,
    period_month        DATE          NOT NULL COMMENT 'first day of the rent month',
    description         VARCHAR(300)  NOT NULL,
    sac_code            VARCHAR(10)   NOT NULL,
    taxable_value       DECIMAL(12,2) NOT NULL,
    cgst_rate           DECIMAL(5,2)  NOT NULL,
    sgst_rate           DECIMAL(5,2)  NOT NULL,
    cgst_amount         DECIMAL(12,2) NOT NULL,
    sgst_amount         DECIMAL(12,2) NOT NULL,
    total_amount        DECIMAL(12,2) NOT NULL,
    tds_amount          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tenant_name         VARCHAR(200)  NULL,
    tenant_address      VARCHAR(500)  NULL,
    tenant_gstin        VARCHAR(15)   NULL,
    property_address    VARCHAR(500)  NULL,
    status              ENUM('DRAFT','FINAL','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    cancel_reason       VARCHAR(300)  NULL,
    finalized_by        VARCHAR(45)   NULL,
    finalized_date      TIMESTAMP     NULL,
    cancelled_by        VARCHAR(45)   NULL,
    cancelled_date      TIMESTAMP     NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (invoice_id),
    UNIQUE KEY uniq_rental_invoice_no (location_code, invoice_no),
    KEY idx_rental_invoice_period (location_code, period_month),
    KEY idx_rental_invoice_tenant (tenant_id),
    CONSTRAINT fk_rental_invoice_tenant FOREIGN KEY (tenant_id) REFERENCES m_rental_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- gl_ledgers.source_type += TENANT (appending an ENUM value is metadata-only)
SET @has_tenant := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gl_ledgers' AND COLUMN_NAME = 'source_type'
      AND COLUMN_TYPE LIKE '%''TENANT''%'
);
SET @sql := IF(@has_tenant = 0,
    'ALTER TABLE gl_ledgers MODIFY source_type ENUM(''STATIC'',''SUPPLIER'',''CREDIT'',''BANK'',''EMPLOYEE'',''SYSTEM'',''TENANT'') NOT NULL',
    'SELECT ''gl_ledgers.source_type already has TENANT'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- MC ledgers -----------------------------------------------------------------
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT g.location_code, 'RENT RECEIVED', g.group_id, 'SYSTEM', 'Y', 'system', 'system'
FROM gl_ledger_groups g
WHERE g.location_code = 'MC' AND g.group_name = 'Indirect Incomes'
  AND NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = 'MC' AND l.ledger_name = 'RENT RECEIVED');

INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT g.location_code, 'TDS RECEIVABLE', g.group_id, 'SYSTEM', 'Y', 'system', 'system'
FROM gl_ledger_groups g
WHERE g.location_code = 'MC' AND g.group_name = 'Current Assets'
  AND NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = 'MC' AND l.ledger_name = 'TDS RECEIVABLE');

-- MC settings: landlord details as printed on the Oct-2026 invoices. last_invoice_no
-- is set from the Settings tab before the first run (Oct-2026 used up to 35).
INSERT INTO m_rental_settings
    (location_code, landlord_name, landlord_address, gstin, pan,
     bank_name, bank_branch, bank_ifsc, bank_account_no,
     last_invoice_no, invoice_day, income_ledger_id, tds_ledger_id, created_by, updated_by)
SELECT 'MC', 'A.R. CHINNA NACHIMUTHU',
       'No 737, Gobi - Dharapuram Road, Kunnathur, Tirupur District, Tamil Nadu. Pin: 638 103.',
       '33AFFPC6464C1ZX', 'AFFPC6464C',
       'Indian Overseas Bank', 'Kunnathur', 'IOBA0000163', '016301000000202',
       35, 26,
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = 'MC' AND ledger_name = 'RENT RECEIVED'),
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = 'MC' AND ledger_name = 'TDS RECEIVABLE'),
       'system', 'system'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_rental_settings WHERE location_code = 'MC');

-- Menu: under Accounting, MC only ---------------------------------------------
INSERT IGNORE INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, group_code, effective_start_date, created_by)
VALUES
    ('RENTAL_INVOICES', 'Rental Invoices', 'bi-house-door', '/rental', NULL, 40, 'ACCOUNTING', CURDATE(), 'system');

INSERT INTO m_menu_access_override (role, location_code, menu_code, allowed, effective_start_date, created_by, updated_by)
SELECT r.role, 'MC', 'RENTAL_INVOICES', 1, CURDATE(), 'system', 'system'
FROM (SELECT 'SuperUser' AS role UNION ALL SELECT 'PowerUser' UNION ALL SELECT 'Admin') r
WHERE NOT EXISTS (
    SELECT 1 FROM m_menu_access_override o
    WHERE o.role = r.role AND o.location_code = 'MC' AND o.menu_code = 'RENTAL_INVOICES'
);

CALL RefreshMenuCache();

-- Verify
SELECT 'settings' AS what, COUNT(*) AS n FROM m_rental_settings WHERE location_code = 'MC'
UNION ALL SELECT 'ledgers', COUNT(*) FROM gl_ledgers WHERE location_code = 'MC' AND ledger_name IN ('RENT RECEIVED', 'TDS RECEIVABLE')
UNION ALL SELECT 'menu', COUNT(*) FROM m_menu_items WHERE menu_code = 'RENTAL_INVOICES'
UNION ALL SELECT 'menu access', COUNT(*) FROM m_menu_access_override WHERE menu_code = 'RENTAL_INVOICES';
