-- ============================================================
-- Bowser Stock Statement (tkt #457)
--   1. Opening balance on the bowser master: quantity + the date it applies from
--   2. Access: SuperUser and PowerUser at all locations, Admin at RAN only
-- Run BEFORE deploying the code: the bowser queries select these columns.
-- Safe to re-run.
-- ============================================================

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'm_bowser' AND COLUMN_NAME = 'opening_stock');
SET @sql = IF(@col_exists = 0,
    "ALTER TABLE m_bowser
        ADD COLUMN opening_stock DECIMAL(10,3) NULL COMMENT 'Litres in the bowser at the start of opening_stock_date' AFTER capacity_litres,
        ADD COLUMN opening_stock_date DATE NULL COMMENT 'Stock statement ignores entries before this date' AFTER opening_stock",
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- location_code NULL = all locations. The unique key doesn't stop duplicate NULLs, hence NOT EXISTS.
INSERT INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, location_code, created_by, effective_start_date, effective_end_date)
SELECT r.role_id, r.role_id, 'VIEW_BOWSER_STOCK_STATEMENT', g.location_specific, g.location_code, 'system', CURDATE(), '9999-12-31'
FROM m_roles r
JOIN (
    SELECT 'SuperUser' AS role_name, 0 AS location_specific, NULL AS location_code
    UNION ALL SELECT 'PowerUser', 0, NULL
    UNION ALL SELECT 'Admin', 1, 'RAN'
) g ON g.role_name = r.role_name
WHERE NOT EXISTS (
    SELECT 1 FROM m_role_permissions rp
    WHERE rp.role_id = r.role_id
      AND rp.permission_type = 'VIEW_BOWSER_STOCK_STATEMENT'
      AND rp.location_code <=> g.location_code
);

SELECT r.role_name, rp.permission_type, rp.location_code
FROM m_role_permissions rp
JOIN m_roles r ON r.role_id = rp.role_id
WHERE rp.permission_type = 'VIEW_BOWSER_STOCK_STATEMENT';
