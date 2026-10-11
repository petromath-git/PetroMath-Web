-- Pumps and tanks reference their product by ID (phase 1 of moving off
-- name matching).
--
-- m_pump.product_code / m_tank.product_code hold the product NAME and were
-- the only link to m_product, so renaming a fuel product meant updating
-- every nozzle and tank by hand (e.g. AMT GD -> XG, 2026-10-11) and a
-- mismatch silently dropped a nozzle's price/colour on the closing page.
--
-- This adds product_id to both tables, fills it from the current name match
-- (prod: all 312 pumps and 107 tanks match exactly one product), and keeps
-- it in step with product_code on every insert/update — whatever writes the
-- row (Pump/Tank master, onboarding migrate, scripts). product_code stays the
-- column the masters write for now; readers move to product_id gradually
-- (closing first page first).
--
-- RUN BEFORE deploying the code (the Pump/Tank models read product_id).
-- Re-runnable.

-- ── Columns ────────────────────────────────────────────────────────────────
SET @has = (SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'm_pump' AND column_name = 'product_id');
SET @sql = IF(@has = 0,
    'ALTER TABLE m_pump ADD COLUMN product_id INT NULL AFTER product_code, ADD INDEX idx_pump_product_id (product_id)',
    'SELECT ''m_pump.product_id already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has = (SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'm_tank' AND column_name = 'product_id');
SET @sql = IF(@has = 0,
    'ALTER TABLE m_tank ADD COLUMN product_id INT NULL AFTER product_code, ADD INDEX idx_tank_product_id (product_id)',
    'SELECT ''m_tank.product_id already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Backfill from the name match ────────────────────────────────────────────
UPDATE m_pump p
JOIN   m_product x ON x.location_code = p.location_code AND x.product_name = p.product_code
SET    p.product_id = x.product_id
WHERE  p.product_id IS NULL OR p.product_id <> x.product_id;

UPDATE m_tank t
JOIN   m_product x ON x.location_code = t.location_code AND x.product_name = t.product_code
SET    t.product_id = x.product_id
WHERE  t.product_id IS NULL OR t.product_id <> x.product_id;

-- ── Keep product_id in step with product_code ──────────────────────────────
-- A row written with a product_code that names no product keeps
-- product_id NULL (same as today: the nozzle has no product).
DROP TRIGGER IF EXISTS trg_pump_product_id_ins;
DROP TRIGGER IF EXISTS trg_pump_product_id_upd;
DROP TRIGGER IF EXISTS trg_tank_product_id_ins;
DROP TRIGGER IF EXISTS trg_tank_product_id_upd;

DELIMITER $$
CREATE TRIGGER trg_pump_product_id_ins BEFORE INSERT ON m_pump FOR EACH ROW
BEGIN
    SET NEW.product_id = (SELECT x.product_id FROM m_product x
                          WHERE x.location_code = NEW.location_code AND x.product_name = NEW.product_code
                          ORDER BY x.product_id LIMIT 1);
END$$

CREATE TRIGGER trg_pump_product_id_upd BEFORE UPDATE ON m_pump FOR EACH ROW
BEGIN
    IF NOT (NEW.product_code <=> OLD.product_code) OR NOT (NEW.location_code <=> OLD.location_code)
       OR NEW.product_id IS NULL THEN
        SET NEW.product_id = (SELECT x.product_id FROM m_product x
                              WHERE x.location_code = NEW.location_code AND x.product_name = NEW.product_code
                              ORDER BY x.product_id LIMIT 1);
    END IF;
END$$

CREATE TRIGGER trg_tank_product_id_ins BEFORE INSERT ON m_tank FOR EACH ROW
BEGIN
    SET NEW.product_id = (SELECT x.product_id FROM m_product x
                          WHERE x.location_code = NEW.location_code AND x.product_name = NEW.product_code
                          ORDER BY x.product_id LIMIT 1);
END$$

CREATE TRIGGER trg_tank_product_id_upd BEFORE UPDATE ON m_tank FOR EACH ROW
BEGIN
    IF NOT (NEW.product_code <=> OLD.product_code) OR NOT (NEW.location_code <=> OLD.location_code)
       OR NEW.product_id IS NULL THEN
        SET NEW.product_id = (SELECT x.product_id FROM m_product x
                              WHERE x.location_code = NEW.location_code AND x.product_name = NEW.product_code
                              ORDER BY x.product_id LIMIT 1);
    END IF;
END$$
DELIMITER ;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect no rows: pumps/tanks whose product_id is missing or disagrees with the name
SELECT 'pump' AS kind, p.location_code, p.pump_code AS code, p.product_code, p.product_id
FROM   m_pump p LEFT JOIN m_product x ON x.product_id = p.product_id
WHERE  p.product_id IS NULL OR x.product_name <> p.product_code OR x.location_code <> p.location_code
UNION ALL
SELECT 'tank', t.location_code, t.tank_code, t.product_code, t.product_id
FROM   m_tank t LEFT JOIN m_product x ON x.product_id = t.product_id
WHERE  t.product_id IS NULL OR x.product_name <> t.product_code OR x.location_code <> t.location_code;

SELECT (SELECT COUNT(*) FROM m_pump WHERE product_id IS NOT NULL) AS pumps_linked,
       (SELECT COUNT(*) FROM m_tank WHERE product_id IS NOT NULL) AS tanks_linked;
