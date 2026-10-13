-- m_product.product_type: what a product IS, independent of its editable name.
--
-- Features used to recognise products by hard-coded names ('2T LOOSE',
-- '2T POUCH', 'DSR - OIL', 'CNG', 'MS' ...), so renaming one broke the 2T tab,
-- DSR, reports, day bills and truck loads. They now check product_type
-- (values in config/app-config.js PRODUCT_TYPE).
--
-- Backfill gives a type only to the exact names the app treated specially,
-- so behaviour is unchanged. Not typed (they were never treated specially):
-- SEN "2T-LOOSE", JOE "2T OIL" - a SuperUser can set the type on Products.
--
-- RUN BEFORE product-id-phase3-routines.sql (the routines read product_type).
-- Re-runnable.

SET @has = (SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'm_product' AND column_name = 'product_type');
SET @sql = IF(@has = 0,
    'ALTER TABLE m_product ADD COLUMN product_type VARCHAR(20) NULL AFTER is_lube_product, ADD INDEX idx_product_location_type (location_code, product_type)',
    'SELECT ''m_product.product_type already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- No history row for this (m_product's update trigger ignores product_type)
UPDATE m_product
SET    product_type = CASE UPPER(TRIM(product_name))
                          WHEN 'MS'        THEN 'MS'
                          WHEN 'HSD'       THEN 'HSD'
                          WHEN 'XMS'       THEN 'XMS'
                          WHEN 'GD'        THEN 'GD'
                          WHEN 'E20'       THEN 'E20'
                          WHEN 'CNG'       THEN 'CNG'
                          WHEN '2T LOOSE'  THEN '2T_LOOSE'
                          WHEN '2T POUCH'  THEN '2T_POUCH'
                          WHEN 'DSR - OIL' THEN 'DSR_OIL'
                      END
WHERE  product_type IS NULL
  AND  UPPER(TRIM(product_name)) IN ('MS','HSD','XMS','GD','E20','CNG','2T LOOSE','2T POUCH','DSR - OIL');

-- Tank receipts: fuel columns by the tank's product type, not its name
-- (close_tankreceipt copies MS/HSD/XMS from here into t_truck_load)
CREATE OR REPLACE VIEW t_tank_receipt_v AS
SELECT tr.ttank_id AS ttank_id, tr.invoice_number AS invoice_number, tr.invoice_date AS invoice_date,
       DATE_FORMAT(tr.invoice_date, '%d-%M-%Y') AS fomratted_inv_date,
       DATE_FORMAT(tr.decant_date, '%d-%M-%Y') AS fomratted_decant_date,
       tr.decant_date AS decant_date,
       (SELECT m_tank_truck.truck_number FROM m_tank_truck WHERE m_tank_truck.truck_id = tr.truck_id) AS truck_number,
       tr.odometer_reading AS odometer_reading, tr.location_code AS location_code, tr.truck_id AS truck_id,
       tr.closing_status AS closing_status,
       (SELECT mp.Person_Name FROM m_persons mp WHERE mp.Person_id = tr.driver_id) AS driver,
       (SELECT mp.Person_Name FROM m_persons mp WHERE mp.Person_id = tr.helper_id) AS helper,
       (SELECT mp.Person_Name FROM m_persons mp WHERE mp.Person_id = tr.decant_incharge) AS decant_incharge,
       (SELECT SUM(dt.quantity) FROM t_tank_stk_rcpt_dtl dt JOIN m_tank mt ON mt.tank_id = dt.tank_id
          JOIN m_product p ON p.product_id = mt.product_id
         WHERE p.product_type = 'MS'  AND dt.ttank_id = tr.ttank_id) AS MS,
       (SELECT SUM(dt.quantity) FROM t_tank_stk_rcpt_dtl dt JOIN m_tank mt ON mt.tank_id = dt.tank_id
          JOIN m_product p ON p.product_id = mt.product_id
         WHERE p.product_type = 'HSD' AND dt.ttank_id = tr.ttank_id) AS HSD,
       (SELECT SUM(dt.quantity) FROM t_tank_stk_rcpt_dtl dt JOIN m_tank mt ON mt.tank_id = dt.tank_id
          JOIN m_product p ON p.product_id = mt.product_id
         WHERE p.product_type = 'XMS' AND dt.ttank_id = tr.ttank_id) AS XMS,
       (SELECT SUM(dt.quantity) FROM t_tank_stk_rcpt_dtl dt JOIN m_tank mt ON mt.tank_id = dt.tank_id
          JOIN m_product p ON p.product_id = mt.product_id
         WHERE p.product_type = 'GD'  AND dt.ttank_id = tr.ttank_id) AS GD,
       (SELECT SUM(dt.quantity) FROM t_tank_stk_rcpt_dtl dt JOIN m_tank mt ON mt.tank_id = dt.tank_id
          JOIN m_product p ON p.product_id = mt.product_id
         WHERE p.product_type = 'E20' AND dt.ttank_id = tr.ttank_id) AS E20,
       tr.decant_time AS decant_time,
       (SELECT SUM(t_tank_stk_rcpt_dtl.amount) FROM t_tank_stk_rcpt_dtl WHERE t_tank_stk_rcpt_dtl.ttank_id = tr.ttank_id) AS amount,
       tr.location_id AS location_id, tr.driver_id AS driver_id, tr.helper_id AS helper_id
FROM t_tank_stk_rcpt tr;

-- ── Verify ─────────────────────────────────────────────────────────────────
SELECT product_type, COUNT(*) AS products, GROUP_CONCAT(DISTINCT location_code ORDER BY location_code) AS locations
FROM   m_product WHERE product_type IS NOT NULL GROUP BY product_type;
