-- Phase 5: renaming a product carries the new name to its pumps and tanks.
--
-- Pumps/tanks link to their product by product_id (pump-tank-product-id.sql)
-- and the stored routines and app joins use it (phases 3-4). product_code on
-- m_pump / m_tank is now only the label reports and views show, so a rename
-- updates it here, and the Products page can rename fuel products.
--
-- m_pump.product_code / m_tank.product_code are VARCHAR(50): a product with
-- pumps or tanks cannot be renamed to more than 50 characters.
--
-- RUN AFTER pump-tank-product-id.sql. Re-runnable.

DROP TRIGGER IF EXISTS trg_pump_product_id_upd;
DROP TRIGGER IF EXISTS trg_tank_product_id_upd;
DROP TRIGGER IF EXISTS trg_product_name_to_pump_tank;

DELIMITER $$
-- Same as before, except while a product rename is being carried over
-- (@pt_keep_product_id = 1): then product_id stays as it is.
CREATE TRIGGER trg_pump_product_id_upd BEFORE UPDATE ON m_pump FOR EACH ROW
BEGIN
    IF @pt_keep_product_id IS NULL
       AND (NOT (NEW.product_code <=> OLD.product_code) OR NOT (NEW.location_code <=> OLD.location_code)
            OR NEW.product_id IS NULL) THEN
        SET NEW.product_id = (SELECT x.product_id FROM m_product x
                              WHERE x.location_code = NEW.location_code AND x.product_name = NEW.product_code
                              ORDER BY x.product_id LIMIT 1);
    END IF;
END$$

CREATE TRIGGER trg_tank_product_id_upd BEFORE UPDATE ON m_tank FOR EACH ROW
BEGIN
    IF @pt_keep_product_id IS NULL
       AND (NOT (NEW.product_code <=> OLD.product_code) OR NOT (NEW.location_code <=> OLD.location_code)
            OR NEW.product_id IS NULL) THEN
        SET NEW.product_id = (SELECT x.product_id FROM m_product x
                              WHERE x.location_code = NEW.location_code AND x.product_name = NEW.product_code
                              ORDER BY x.product_id LIMIT 1);
    END IF;
END$$

CREATE TRIGGER trg_product_name_to_pump_tank AFTER UPDATE ON m_product FOR EACH ROW
FOLLOWS trg_product_ledger_sync
BEGIN
    IF NOT (BINARY NEW.product_name <=> BINARY OLD.product_name) THEN
        IF CHAR_LENGTH(NEW.product_name) > 50
           AND (EXISTS (SELECT 1 FROM m_pump WHERE product_id = NEW.product_id)
                OR EXISTS (SELECT 1 FROM m_tank WHERE product_id = NEW.product_id)) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A product with pumps or tanks can have at most 50 characters in its name.';
        END IF;
        SET @pt_keep_product_id = 1;
        UPDATE m_pump SET product_code = NEW.product_name WHERE product_id = NEW.product_id;
        UPDATE m_tank SET product_code = NEW.product_name WHERE product_id = NEW.product_id;
        SET @pt_keep_product_id = NULL;
    END IF;
END$$
DELIMITER ;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect no rows: pump/tank label differs from its product's name
SELECT 'pump' AS kind, p.location_code, p.pump_code AS code, p.product_code, x.product_name
FROM   m_pump p JOIN m_product x ON x.product_id = p.product_id
WHERE  BINARY p.product_code <> BINARY x.product_name
UNION ALL
SELECT 'tank', t.location_code, t.tank_code, t.product_code, x.product_name
FROM   m_tank t JOIN m_product x ON x.product_id = t.product_id
WHERE  BINARY t.product_code <> BINARY x.product_name;
