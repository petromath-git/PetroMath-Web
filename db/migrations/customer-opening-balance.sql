-- Migration: customer opening balance from Customer Master
--
-- A customer's opening balance is one Opening Balance Entry adjustment
-- (t_adjustments, adjustment_type 201, external_source CUSTOMER). Customer
-- Master now sets and edits it; the Adjustments screen no longer offers type
-- 201 for customers and won't delete a customer's opening balance.
-- Statements are unchanged.
--
-- t_adjustments_history keeps the old values each time an opening balance is
-- edited. Built like t_adjustments_deleted, so the app copies columns by name
-- — a column later added to t_adjustments must be added here too.
--
-- Re-runnable: the table is created only if missing.

SET @tbl_exists = (
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 't_adjustments_history'
);
SET @sql = IF(@tbl_exists = 0,
    'CREATE TABLE t_adjustments_history AS SELECT * FROM t_adjustments WHERE 1 = 0',
    'SELECT ''t_adjustments_history already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(@tbl_exists = 0,
    'ALTER TABLE t_adjustments_history
         ADD COLUMN history_id     INT          NOT NULL AUTO_INCREMENT FIRST,
         ADD COLUMN changed_by     VARCHAR(45)  NOT NULL,
         ADD COLUMN changed_date   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
         ADD COLUMN change_reason  VARCHAR(500) NULL,
         ADD PRIMARY KEY (history_id),
         ADD INDEX idx_adj_history_adjustment (adjustment_id)',
    'SELECT ''t_adjustments_history columns already added''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- Customers with more than one opening entry (Customer Master won't edit
-- these until the wrong one is deleted)
SELECT a.location_code, a.external_id AS creditlist_id, c.Company_Name, COUNT(*) AS entries
FROM   t_adjustments a
JOIN   m_credit_list c ON c.creditlist_id = a.external_id
WHERE  a.adjustment_type = '201' AND a.external_source = 'CUSTOMER' AND a.status = 'ACTIVE'
GROUP  BY a.location_code, a.external_id, c.Company_Name
HAVING COUNT(*) > 1
ORDER  BY a.location_code, c.Company_Name;
