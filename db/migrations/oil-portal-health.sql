-- ============================================================================
-- IOCL e-Mitra portal: configurable address + daily health check (no login).
--
-- m_oil_portal_health: one row per portal. The app checks the login page every
-- morning (and hourly while not OK) WITHOUT logging in:
--   OK          - login page, security question and APIs look as expected
--   UNREACHABLE - portal didn't answer (maintenance / network); pulls still allowed
--   CHANGED     - portal looks different; pulls refused until a later check passes
--
-- IOCL_PORTAL_BASE_URL ('*' = all locations): change here if IOCL moves the portal
-- to a new domain without a redirect - no deploy needed.
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS m_oil_portal_health (
    portal_code    VARCHAR(30)  NOT NULL,
    status         VARCHAR(20)  NOT NULL COMMENT 'OK / UNREACHABLE / CHANGED',
    detail         VARCHAR(500) NULL,
    checked_at     DATETIME     NULL,
    status_since   DATETIME     NULL,
    last_ok_at     DATETIME     NULL,
    PRIMARY KEY (portal_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO m_location_config_catalog
    (setting_name, short_description, detailed_description, value_type, lookup_type, created_by, updated_by)
SELECT 'IOCL_PORTAL_BASE_URL',
       'IOCL e-Mitra portal address',
       'Base address of the IOCL e-Mitra (SDMS) portal used by the statement pull, e.g. https://utkarsh.indianoil.co.in. Set only for * (all locations). Change it if IOCL moves the portal to a new domain without a redirect.',
       'TEXT', NULL, 'system', 'system'
WHERE NOT EXISTS (SELECT 1 FROM m_location_config_catalog WHERE setting_name = 'IOCL_PORTAL_BASE_URL');

INSERT INTO m_location_config
    (location_code, setting_name, setting_value, effective_start_date, effective_end_date,
     created_by, updated_by, creation_date, updation_date)
SELECT '*', 'IOCL_PORTAL_BASE_URL', 'https://utkarsh.indianoil.co.in', CURDATE(), '9999-12-31',
       'system', 'system', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM m_location_config
                  WHERE location_code = '*' AND setting_name = 'IOCL_PORTAL_BASE_URL');
