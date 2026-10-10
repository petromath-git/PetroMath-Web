-- Migration: product opening stock from the Products page
--
-- A product's opening stock is one OPENING row in t_lubes_stock_adjustment.
-- The Products page now sets and edits it; the Stock Adjustment screen no
-- longer offers OPENING and won't take an IN/OUT dated before the opening.
--
-- t_lubes_stock_adjustment_history keeps the old values each time an opening
-- is edited (and rows merged away by data fixes). The app copies columns by
-- name — a column later added to t_lubes_stock_adjustment must be added here too.
--
-- STOCK_OPENING_LATE_START = Y lets a location start stock tracking after its
-- first sale (sales/purchases before the opening date are not counted). Only
-- for locations that used PetroMath before stock tracking was built.
--
-- Re-runnable.

SET @tbl_exists = (
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 't_lubes_stock_adjustment_history'
);
SET @sql = IF(@tbl_exists = 0,
    'CREATE TABLE t_lubes_stock_adjustment_history AS SELECT * FROM t_lubes_stock_adjustment WHERE 1 = 0',
    'SELECT ''t_lubes_stock_adjustment_history already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(@tbl_exists = 0,
    'ALTER TABLE t_lubes_stock_adjustment_history
         ADD COLUMN history_id     INT          NOT NULL AUTO_INCREMENT FIRST,
         ADD COLUMN changed_by     VARCHAR(45)  NOT NULL,
         ADD COLUMN changed_date   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
         ADD COLUMN change_reason  VARCHAR(500) NULL,
         ADD PRIMARY KEY (history_id),
         ADD INDEX idx_stock_adj_history_adjustment (adjustment_id)',
    'SELECT ''t_lubes_stock_adjustment_history columns already added''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
SELECT l.code, 'STOCK_OPENING_LATE_START', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
FROM   (SELECT 'MC' AS code UNION ALL SELECT 'MC2' UNION ALL SELECT 'MUE' UNION ALL SELECT 'MME') l
WHERE  NOT EXISTS (SELECT 1 FROM m_location_config c
                   WHERE c.location_code = l.code AND c.setting_name = 'STOCK_OPENING_LATE_START');


-- ── Verify ─────────────────────────────────────────────────────────────────
SELECT location_code, setting_name, setting_value, effective_start_date, effective_end_date
FROM   m_location_config
WHERE  setting_name = 'STOCK_OPENING_LATE_START';

-- Products with more than one opening entry (Products page won't edit these)
SELECT a.location_code, p.product_name, COUNT(*) AS entries
FROM   t_lubes_stock_adjustment a
JOIN   m_product p ON p.product_id = a.product_id
WHERE  a.adjustment_type = 'OPENING'
GROUP  BY a.location_code, p.product_name
HAVING COUNT(*) > 1;
