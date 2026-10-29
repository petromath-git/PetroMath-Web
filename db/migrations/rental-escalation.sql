-- ============================================================================
-- Rental invoices: rent revisions + escalation — tkt #35
--
-- 1. m_rental_rent_revision — rent history per tenant: "₹X a month from month Y".
--    START = the opening rent; REVISION = entered by hand (fixed-amount
--    agreements are just future-dated revisions); ESCALATION = added
--    automatically by the % rule when a draft is created for that month.
--    Drafts take the rent of the latest revision on or before the rent month.
-- 2. Escalation rule on the tenant (optional): +escalation_percent every
--    escalation_every_months, next due escalation_next (first of a month),
--    compounding on the rent in force at that month.
-- 3. A START revision for every existing tenant from its current rent.
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS m_rental_rent_revision (
    revision_id     INT           NOT NULL AUTO_INCREMENT,
    tenant_id       INT           NOT NULL,
    effective_from  DATE          NOT NULL COMMENT 'first day of the rent month',
    monthly_rent    DECIMAL(12,2) NOT NULL,
    source          ENUM('START','REVISION','ESCALATION') NOT NULL DEFAULT 'REVISION',
    note            VARCHAR(200)  NULL,
    created_by      VARCHAR(45)   NULL,
    creation_date   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (revision_id),
    UNIQUE KEY uniq_rent_revision_month (tenant_id, effective_from),
    CONSTRAINT fk_rent_revision_tenant FOREIGN KEY (tenant_id) REFERENCES m_rental_tenant (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

CALL tmp_add_col('m_rental_tenant', 'escalation_percent',      'DECIMAL(5,2) NULL AFTER tds_percent');
CALL tmp_add_col('m_rental_tenant', 'escalation_every_months', 'SMALLINT NULL AFTER escalation_percent');
CALL tmp_add_col('m_rental_tenant', 'escalation_next',         'DATE NULL AFTER escalation_every_months');

DROP PROCEDURE IF EXISTS tmp_add_col;

-- Opening rent for tenants entered before revisions existed
INSERT INTO m_rental_rent_revision (tenant_id, effective_from, monthly_rent, source, note, created_by)
SELECT t.tenant_id, DATE_FORMAT(t.start_date, '%Y-%m-01'), t.monthly_rent, 'START', 'Opening rent', 'system'
FROM m_rental_tenant t
WHERE NOT EXISTS (SELECT 1 FROM m_rental_rent_revision r WHERE r.tenant_id = t.tenant_id);

-- Verify
SELECT 'tenants' AS what, COUNT(*) AS n FROM m_rental_tenant
UNION ALL SELECT 'start revisions', COUNT(*) FROM m_rental_rent_revision WHERE source = 'START'
UNION ALL SELECT 'escalation columns', COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'm_rental_tenant' AND COLUMN_NAME LIKE 'escalation%';
