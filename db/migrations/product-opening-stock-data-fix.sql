-- Data fix (prod IDs): tidy opening stock so the Products page can show and
-- edit it. Run AFTER product-opening-stock.sql (needs the history table).
-- Every changed or deleted row is first copied to t_lubes_stock_adjustment_history.
--
-- 1. Openings entered as Stock IN (before the OPENING type existed) become
--    OPENING: MC 43, MC2 48, MUE 51 (dated 01-APR-2024), SPFP 7, AKMN #233,
--    SFS #199. Same date and qty, so stock balances don't change.
-- 2. Two "opening" rows for one product are summed (same date, balance unchanged):
--      MC2 PREMIUM CF-4 1 LTR  #15 19 + #22 6  -> #15 = 25, #22 deleted
--      MUE GEAR 140 1 LTR      #33 4  + #35 8  -> #33 = 12, #35 deleted
-- 3. MUE MS: OPENING #235 13,814 was corrected with OUT #236 13,814 and
--    IN #237 25,119 on the same day -> #235 = 25,119, #236 and #237 deleted
--    (balance unchanged).
-- 4. AMT openings #297-#310 dated 02-OCT / 06-OCT move to 01-OCT-2026, the
--    first shift. Quantities stay, so 01-OCT onward sales now count against
--    them: THIS CHANGES AMT STOCK BALANCES (user confirmed 2026-10-10).
--
-- Each step matches the original values, so a re-run does nothing.

-- ── Balances before ─────────────────────────────────────────────────────────
DROP TEMPORARY TABLE IF EXISTS tmp_stock_before;
CREATE TEMPORARY TABLE tmp_stock_before AS
SELECT DISTINCT a.location_code, a.product_id,
       get_closing_product_stock_balance(a.product_id, a.location_code, CURDATE()) AS bal
FROM   t_lubes_stock_adjustment a
WHERE  a.location_code IN ('MC', 'MC2', 'MUE', 'SPFP', 'AKMN', 'SFS', 'AMT');

-- ── 2. Merge the duplicate legacy rows (before converting them) ─────────────
INSERT INTO t_lubes_stock_adjustment_history
SELECT NULL, a.*, 'SAKTHI', NOW(), 'Merged with #22: opening is the sum of both entries'
FROM   t_lubes_stock_adjustment a
WHERE  a.adjustment_id = 15 AND a.location_code = 'MC2' AND a.qty = 19.00
  AND  EXISTS (SELECT 1 FROM (SELECT * FROM t_lubes_stock_adjustment) b WHERE b.adjustment_id = 22 AND b.qty = 6.00);
INSERT INTO t_lubes_stock_adjustment_history
SELECT NULL, a.*, 'SAKTHI', NOW(), 'Merged into #15 and deleted'
FROM   t_lubes_stock_adjustment a
WHERE  a.adjustment_id = 22 AND a.location_code = 'MC2' AND a.qty = 6.00
  AND  EXISTS (SELECT 1 FROM (SELECT * FROM t_lubes_stock_adjustment) b WHERE b.adjustment_id = 15 AND b.qty = 19.00);
SET @mc2_dup = (SELECT COUNT(*) FROM t_lubes_stock_adjustment WHERE adjustment_id = 22 AND qty = 6.00);
UPDATE t_lubes_stock_adjustment SET qty = 25.00, updated_by = 'SAKTHI'
WHERE  adjustment_id = 15 AND location_code = 'MC2' AND qty = 19.00 AND @mc2_dup = 1;
DELETE FROM t_lubes_stock_adjustment
WHERE  adjustment_id = 22 AND location_code = 'MC2' AND qty = 6.00
  AND  EXISTS (SELECT 1 FROM t_lubes_stock_adjustment_history h WHERE h.adjustment_id = 22);

INSERT INTO t_lubes_stock_adjustment_history
SELECT NULL, a.*, 'SAKTHI', NOW(), 'Merged with #35: opening is the sum of both entries'
FROM   t_lubes_stock_adjustment a
WHERE  a.adjustment_id = 33 AND a.location_code = 'MUE' AND a.qty = 4.00
  AND  EXISTS (SELECT 1 FROM (SELECT * FROM t_lubes_stock_adjustment) b WHERE b.adjustment_id = 35 AND b.qty = 8.00);
INSERT INTO t_lubes_stock_adjustment_history
SELECT NULL, a.*, 'SAKTHI', NOW(), 'Merged into #33 and deleted'
FROM   t_lubes_stock_adjustment a
WHERE  a.adjustment_id = 35 AND a.location_code = 'MUE' AND a.qty = 8.00
  AND  EXISTS (SELECT 1 FROM (SELECT * FROM t_lubes_stock_adjustment) b WHERE b.adjustment_id = 33 AND b.qty = 4.00);
SET @mue_dup = (SELECT COUNT(*) FROM t_lubes_stock_adjustment WHERE adjustment_id = 35 AND qty = 8.00);
UPDATE t_lubes_stock_adjustment SET qty = 12.00, updated_by = 'SAKTHI'
WHERE  adjustment_id = 33 AND location_code = 'MUE' AND qty = 4.00 AND @mue_dup = 1;
DELETE FROM t_lubes_stock_adjustment
WHERE  adjustment_id = 35 AND location_code = 'MUE' AND qty = 8.00
  AND  EXISTS (SELECT 1 FROM t_lubes_stock_adjustment_history h WHERE h.adjustment_id = 35);

-- ── 1. Stock IN openings -> OPENING ─────────────────────────────────────────
DROP TEMPORARY TABLE IF EXISTS tmp_in_openings;
CREATE TEMPORARY TABLE tmp_in_openings (adjustment_id INT PRIMARY KEY);
INSERT INTO tmp_in_openings VALUES
    -- MC
    (137),(138),(139),(140),(141),(142),(143),(144),(145),(146),(147),(148),(149),(150),(151),
    (152),(153),(154),(155),(156),(157),(158),(159),(160),(161),(162),(163),(164),(165),(166),
    (167),(168),(169),(170),(171),(172),(173),(174),(175),(176),(177),(178),(179),
    -- MC2 (#22 merged into #15 above)
    (2),(3),(4),(5),(6),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18),(19),(20),(21),
    (24),(26),(27),(29),(30),(31),(32),(42),(43),(44),(45),(46),(47),(48),(49),(50),(51),(52),
    (53),(54),(55),(56),(57),(58),(59),(60),(61),(62),
    -- MUE (#35 merged into #33 above)
    (7),(23),(25),(28),(33),(34),(36),(37),(38),(39),(40),(41),(73),(74),(75),(76),(77),(78),
    (79),(80),(81),(82),(83),(84),(85),(86),(87),(88),(89),(90),(91),(92),(93),(94),(95),(96),
    (97),(98),(99),(100),(101),(102),(103),(104),(105),(106),(107),(108),(109),(110),
    -- SPFP, AKMN, SFS
    (180),(181),(182),(183),(184),(185),(186),(233),(199);

INSERT INTO t_lubes_stock_adjustment_history
SELECT NULL, a.*, 'SAKTHI', NOW(), 'Entered as Stock IN before opening stock existed; changed to OPENING'
FROM   t_lubes_stock_adjustment a
JOIN   tmp_in_openings t ON t.adjustment_id = a.adjustment_id
WHERE  a.adjustment_type = 'IN'
  AND  NOT EXISTS (SELECT 1 FROM (SELECT * FROM t_lubes_stock_adjustment) o
                   WHERE o.product_id = a.product_id AND o.location_code = a.location_code
                     AND o.adjustment_type = 'OPENING');

UPDATE t_lubes_stock_adjustment a
JOIN   tmp_in_openings t ON t.adjustment_id = a.adjustment_id
SET    a.adjustment_type = 'OPENING', a.updated_by = 'SAKTHI'
WHERE  a.adjustment_type = 'IN'
  AND  NOT EXISTS (SELECT 1 FROM (SELECT * FROM t_lubes_stock_adjustment) o
                   WHERE o.product_id = a.product_id AND o.location_code = a.location_code
                     AND o.adjustment_type = 'OPENING');

-- ── 3. MUE MS: fold the same-day OUT/IN correction into the opening ─────────
SET @ms_fix = (SELECT COUNT(*) FROM t_lubes_stock_adjustment
               WHERE (adjustment_id = 236 AND adjustment_type = 'OUT' AND qty = 13814.00)
                  OR (adjustment_id = 237 AND adjustment_type = 'IN'  AND qty = 25119.00));
INSERT INTO t_lubes_stock_adjustment_history
SELECT NULL, a.*, 'SAKTHI', NOW(),
       CASE a.adjustment_id
            WHEN 235 THEN 'Opening corrected to 25119 (was fixed with OUT #236 / IN #237)'
            ELSE 'Same-day correction of opening #235; folded into it and deleted' END
FROM   t_lubes_stock_adjustment a
WHERE  a.adjustment_id IN (235, 236, 237) AND a.location_code = 'MUE' AND @ms_fix = 2;
UPDATE t_lubes_stock_adjustment SET qty = 25119.00, updated_by = 'SAKTHI'
WHERE  adjustment_id = 235 AND location_code = 'MUE' AND adjustment_type = 'OPENING'
  AND  qty = 13814.00 AND @ms_fix = 2;
DELETE FROM t_lubes_stock_adjustment
WHERE  adjustment_id IN (236, 237) AND location_code = 'MUE' AND @ms_fix = 2
  AND  EXISTS (SELECT 1 FROM t_lubes_stock_adjustment_history h WHERE h.adjustment_id = 235)
  AND  (SELECT qty FROM (SELECT * FROM t_lubes_stock_adjustment) x WHERE x.adjustment_id = 235) = 25119.00;

-- ── 4. AMT openings to the first shift date ─────────────────────────────────
INSERT INTO t_lubes_stock_adjustment_history
SELECT NULL, a.*, 'SAKTHI', NOW(), 'Opening moved to the first shift date 01-OCT-2026'
FROM   t_lubes_stock_adjustment a
WHERE  a.adjustment_id BETWEEN 297 AND 310 AND a.location_code = 'AMT'
  AND  a.adjustment_type = 'OPENING' AND a.adjustment_date > '2026-10-01';
UPDATE t_lubes_stock_adjustment SET adjustment_date = '2026-10-01', updated_by = 'SAKTHI'
WHERE  adjustment_id BETWEEN 297 AND 310 AND location_code = 'AMT'
  AND  adjustment_type = 'OPENING' AND adjustment_date > '2026-10-01';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Stock IN rows left that are a product's first entry (expect none)
SELECT a.location_code, COUNT(*) AS in_rows_still_first
FROM   t_lubes_stock_adjustment a
WHERE  a.adjustment_type = 'IN'
  AND  NOT EXISTS (SELECT 1 FROM (SELECT * FROM t_lubes_stock_adjustment) b
                   WHERE b.product_id = a.product_id AND b.location_code = a.location_code
                     AND b.adjustment_date < a.adjustment_date)
  AND  NOT EXISTS (SELECT 1 FROM (SELECT * FROM t_lubes_stock_adjustment) o
                   WHERE o.product_id = a.product_id AND o.location_code = a.location_code
                     AND o.adjustment_type = 'OPENING')
GROUP  BY a.location_code;

-- Products with more than one opening (expect none)
SELECT location_code, product_id, COUNT(*) AS openings
FROM   t_lubes_stock_adjustment WHERE adjustment_type = 'OPENING'
GROUP  BY location_code, product_id HAVING COUNT(*) > 1;

-- Balance changes: expect rows for AMT only
SELECT b.location_code, p.product_name, b.bal AS before_bal,
       get_closing_product_stock_balance(b.product_id, b.location_code, CURDATE()) AS after_bal
FROM   tmp_stock_before b
JOIN   m_product p ON p.product_id = b.product_id
WHERE  NOT (b.bal <=> get_closing_product_stock_balance(b.product_id, b.location_code, CURDATE()))
ORDER  BY b.location_code, p.product_name;

DROP TEMPORARY TABLE IF EXISTS tmp_stock_before;
DROP TEMPORARY TABLE IF EXISTS tmp_in_openings;
