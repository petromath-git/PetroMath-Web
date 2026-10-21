-- ============================================================================
-- Oil Company Accounts master + IOCL e-Mitra portal pull
--
-- 1. m_oil_portal_credential: one portal login per oil-company account (m_bank row
--    with is_oil_company='Y'). Password is AES-256-GCM encrypted by the app with
--    PORTAL_CRED_KEY from .env; the key is never stored in the DB.
-- 2. New Masters menu "Oil Company Accounts" (/oil-company-accounts), same roles as
--    Bank Master. Bank Master itself now lists only is_oil_company='N' accounts.
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS m_oil_portal_credential (
    bank_id            INT          NOT NULL,
    location_code      VARCHAR(50)  NOT NULL,
    portal_code        VARCHAR(30)  NOT NULL DEFAULT 'IOCL_EMITRA',
    username           VARCHAR(50)  NOT NULL,
    password_enc       VARCHAR(500) NOT NULL,
    last_pull_at       DATETIME     NULL,
    last_pull_status   VARCHAR(20)  NULL COMMENT 'OK / FAILED',
    last_pull_message  VARCHAR(500) NULL,
    created_by         VARCHAR(45)  NULL,
    updated_by         VARCHAR(45)  NULL,
    creation_date      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (bank_id),
    KEY idx_oil_portal_cred_location (location_code),
    CONSTRAINT fk_oil_portal_cred_bank FOREIGN KEY (bank_id) REFERENCES m_bank (bank_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Menu item next to Bank Master
INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, restriction_level,
     effective_start_date, created_by, updated_by, group_code)
SELECT 'MASTERS_OIL_COMPANY_ACCOUNTS', 'Oil Company Accounts', 'bi-fuel-pump', '/oil-company-accounts',
       'MASTERS', 61, 3, CURDATE(), 'system', 'system', 'MASTERS'
WHERE NOT EXISTS (SELECT 1 FROM m_menu_items WHERE menu_code = 'MASTERS_OIL_COMPANY_ACCOUNTS');

-- Same role access as Bank Master
INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, effective_end_date, created_by, updated_by)
SELECT g.role, 'MASTERS_OIL_COMPANY_ACCOUNTS', g.allowed, CURDATE(), g.effective_end_date, 'system', 'system'
FROM m_menu_access_global g
WHERE g.menu_code = 'MASTERS_BANK'
  AND CURDATE() BETWEEN g.effective_start_date AND COALESCE(g.effective_end_date, '9999-12-31')
  AND NOT EXISTS (SELECT 1 FROM m_menu_access_global x
                  WHERE x.menu_code = 'MASTERS_OIL_COMPANY_ACCOUNTS' AND x.role = g.role);

CALL RefreshMenuCache();

-- Feature gate: portal login + pull stay hidden until switched on per location (or '*').
-- Our servers are in AWS us-east and the IOCL portal does not answer from there yet,
-- so this ships OFF everywhere.
INSERT INTO m_location_config_catalog
    (setting_name, short_description, detailed_description, value_type, lookup_type, created_by, updated_by)
SELECT 'IOCL_PORTAL_PULL_ENABLED',
       'IOCL e-Mitra statement pull',
       'Y shows the Portal Login column on Oil Company Accounts and the "Pull statement from IOCL portal" box on Upload Transactions. N hides both and the server refuses portal calls.',
       'LOOKUP', 'YN_FLAG', 'system', 'system'
WHERE NOT EXISTS (SELECT 1 FROM m_location_config_catalog WHERE setting_name = 'IOCL_PORTAL_PULL_ENABLED');

INSERT INTO m_location_config
    (location_code, setting_name, setting_value, effective_start_date, effective_end_date,
     created_by, updated_by, creation_date, updation_date)
SELECT '*', 'IOCL_PORTAL_PULL_ENABLED', 'N', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM m_location_config
                  WHERE location_code = '*' AND setting_name = 'IOCL_PORTAL_PULL_ENABLED');

SELECT menu_code, menu_name, url_path, parent_code, sequence
FROM m_menu_items WHERE menu_code = 'MASTERS_OIL_COMPANY_ACCOUNTS';
SELECT role, allowed FROM m_menu_access_global WHERE menu_code = 'MASTERS_OIL_COMPANY_ACCOUNTS';
