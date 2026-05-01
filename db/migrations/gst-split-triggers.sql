-- ============================================================
-- GST Split Triggers
-- Generated: 2026-05-01
--
-- Automatically populates GST fields on t_credits and t_cashsales
-- on every INSERT and UPDATE, by looking up the product's
-- cgst_percent / sgst_percent from m_product.
--
-- Fields populated:
--   cgst_percent  ← m_product.cgst_percent
--   sgst_percent  ← m_product.sgst_percent
--   base_amount   = amount / (1 + (cgst + sgst) / 100)   [GST-exclusive]
--   cgst_amount   = base_amount × cgst_percent / 100
--   sgst_amount   = base_amount × sgst_percent / 100
--
-- For fuel (cgst_percent = 0 or NULL):
--   base_amount = amount, all tax fields = 0
--
-- Fires on every INSERT and every UPDATE so corrections to amount
-- or product_id are always reflected in the tax fields.
--
-- Gated by @disable_triggers: SET @disable_triggers = 1 before any
-- bulk operation (backfill, data migration, dev refresh restore) to
-- skip per-row lookups. Reset to 0 or NULL when done.
-- ============================================================

DROP TRIGGER IF EXISTS trg_credits_gst_before_insert;
DROP TRIGGER IF EXISTS trg_credits_gst_before_update;
DROP TRIGGER IF EXISTS trg_cashsales_gst_before_insert;
DROP TRIGGER IF EXISTS trg_cashsales_gst_before_update;

DELIMITER $$

-- ── t_credits : BEFORE INSERT ─────────────────────────────────────────────────

CREATE TRIGGER trg_credits_gst_before_insert
BEFORE INSERT ON t_credits
FOR EACH ROW
BEGIN
    DECLARE v_cgst DECIMAL(5,2) DEFAULT 0;
    DECLARE v_sgst DECIMAL(5,2) DEFAULT 0;
    DECLARE v_base DECIMAL(15,3);

    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        SELECT COALESCE(cgst_percent, 0), COALESCE(sgst_percent, 0)
        INTO   v_cgst, v_sgst
        FROM   m_product
        WHERE  product_id = NEW.product_id
        LIMIT 1;

        SET NEW.cgst_percent = v_cgst;
        SET NEW.sgst_percent = v_sgst;

        IF v_cgst > 0 OR v_sgst > 0 THEN
            SET v_base           = COALESCE(NEW.amount, 0) / (1 + (v_cgst + v_sgst) / 100);
            SET NEW.base_amount  = ROUND(v_base, 3);
            SET NEW.cgst_amount  = ROUND(v_base * v_cgst / 100, 3);
            SET NEW.sgst_amount  = ROUND(v_base * v_sgst / 100, 3);
        ELSE
            SET NEW.base_amount  = COALESCE(NEW.amount, 0);
            SET NEW.cgst_amount  = 0;
            SET NEW.sgst_amount  = 0;
        END IF;

    END IF;
END$$

-- ── t_credits : BEFORE UPDATE ─────────────────────────────────────────────────

CREATE TRIGGER trg_credits_gst_before_update
BEFORE UPDATE ON t_credits
FOR EACH ROW
BEGIN
    DECLARE v_cgst DECIMAL(5,2) DEFAULT 0;
    DECLARE v_sgst DECIMAL(5,2) DEFAULT 0;
    DECLARE v_base DECIMAL(15,3);

    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        SELECT COALESCE(cgst_percent, 0), COALESCE(sgst_percent, 0)
        INTO   v_cgst, v_sgst
        FROM   m_product
        WHERE  product_id = NEW.product_id
        LIMIT 1;

        SET NEW.cgst_percent = v_cgst;
        SET NEW.sgst_percent = v_sgst;

        IF v_cgst > 0 OR v_sgst > 0 THEN
            SET v_base           = COALESCE(NEW.amount, 0) / (1 + (v_cgst + v_sgst) / 100);
            SET NEW.base_amount  = ROUND(v_base, 3);
            SET NEW.cgst_amount  = ROUND(v_base * v_cgst / 100, 3);
            SET NEW.sgst_amount  = ROUND(v_base * v_sgst / 100, 3);
        ELSE
            SET NEW.base_amount  = COALESCE(NEW.amount, 0);
            SET NEW.cgst_amount  = 0;
            SET NEW.sgst_amount  = 0;
        END IF;

    END IF;
END$$

-- ── t_cashsales : BEFORE INSERT ───────────────────────────────────────────────

CREATE TRIGGER trg_cashsales_gst_before_insert
BEFORE INSERT ON t_cashsales
FOR EACH ROW
BEGIN
    DECLARE v_cgst DECIMAL(5,2) DEFAULT 0;
    DECLARE v_sgst DECIMAL(5,2) DEFAULT 0;
    DECLARE v_base DECIMAL(15,3);

    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        SELECT COALESCE(cgst_percent, 0), COALESCE(sgst_percent, 0)
        INTO   v_cgst, v_sgst
        FROM   m_product
        WHERE  product_id = NEW.product_id
        LIMIT 1;

        SET NEW.cgst_percent = v_cgst;
        SET NEW.sgst_percent = v_sgst;

        IF v_cgst > 0 OR v_sgst > 0 THEN
            SET v_base           = COALESCE(NEW.amount, 0) / (1 + (v_cgst + v_sgst) / 100);
            SET NEW.base_amount  = ROUND(v_base, 3);
            SET NEW.cgst_amount  = ROUND(v_base * v_cgst / 100, 3);
            SET NEW.sgst_amount  = ROUND(v_base * v_sgst / 100, 3);
        ELSE
            SET NEW.base_amount  = COALESCE(NEW.amount, 0);
            SET NEW.cgst_amount  = 0;
            SET NEW.sgst_amount  = 0;
        END IF;

    END IF;
END$$

-- ── t_cashsales : BEFORE UPDATE ───────────────────────────────────────────────

CREATE TRIGGER trg_cashsales_gst_before_update
BEFORE UPDATE ON t_cashsales
FOR EACH ROW
BEGIN
    DECLARE v_cgst DECIMAL(5,2) DEFAULT 0;
    DECLARE v_sgst DECIMAL(5,2) DEFAULT 0;
    DECLARE v_base DECIMAL(15,3);

    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        SELECT COALESCE(cgst_percent, 0), COALESCE(sgst_percent, 0)
        INTO   v_cgst, v_sgst
        FROM   m_product
        WHERE  product_id = NEW.product_id
        LIMIT 1;

        SET NEW.cgst_percent = v_cgst;
        SET NEW.sgst_percent = v_sgst;

        IF v_cgst > 0 OR v_sgst > 0 THEN
            SET v_base           = COALESCE(NEW.amount, 0) / (1 + (v_cgst + v_sgst) / 100);
            SET NEW.base_amount  = ROUND(v_base, 3);
            SET NEW.cgst_amount  = ROUND(v_base * v_cgst / 100, 3);
            SET NEW.sgst_amount  = ROUND(v_base * v_sgst / 100, 3);
        ELSE
            SET NEW.base_amount  = COALESCE(NEW.amount, 0);
            SET NEW.cgst_amount  = 0;
            SET NEW.sgst_amount  = 0;
        END IF;

    END IF;
END$$

DELIMITER ;

-- ── Backfill existing rows ────────────────────────────────────────────────────
-- Disable triggers for bulk backfill, then re-enable.

SET @disable_triggers = 1;

-- t_credits backfill
UPDATE t_credits tc
JOIN m_product mp ON mp.product_id = tc.product_id
SET
    tc.cgst_percent = COALESCE(mp.cgst_percent, 0),
    tc.sgst_percent = COALESCE(mp.sgst_percent, 0),
    tc.base_amount  = CASE
                        WHEN COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) > 0
                        THEN ROUND(tc.amount / (1 + (COALESCE(mp.cgst_percent,0) + COALESCE(mp.sgst_percent,0)) / 100), 3)
                        ELSE tc.amount
                      END,
    tc.cgst_amount  = CASE
                        WHEN COALESCE(mp.cgst_percent, 0) > 0
                        THEN ROUND(
                               tc.amount / (1 + (COALESCE(mp.cgst_percent,0) + COALESCE(mp.sgst_percent,0)) / 100)
                               * COALESCE(mp.cgst_percent,0) / 100, 3)
                        ELSE 0
                      END,
    tc.sgst_amount  = CASE
                        WHEN COALESCE(mp.sgst_percent, 0) > 0
                        THEN ROUND(
                               tc.amount / (1 + (COALESCE(mp.cgst_percent,0) + COALESCE(mp.sgst_percent,0)) / 100)
                               * COALESCE(mp.sgst_percent,0) / 100, 3)
                        ELSE 0
                      END
WHERE tc.cgst_percent IS NULL;

-- t_cashsales backfill
UPDATE t_cashsales cs
JOIN m_product mp ON mp.product_id = cs.product_id
SET
    cs.cgst_percent = COALESCE(mp.cgst_percent, 0),
    cs.sgst_percent = COALESCE(mp.sgst_percent, 0),
    cs.base_amount  = CASE
                        WHEN COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) > 0
                        THEN ROUND(cs.amount / (1 + (COALESCE(mp.cgst_percent,0) + COALESCE(mp.sgst_percent,0)) / 100), 3)
                        ELSE cs.amount
                      END,
    cs.cgst_amount  = CASE
                        WHEN COALESCE(mp.cgst_percent, 0) > 0
                        THEN ROUND(
                               cs.amount / (1 + (COALESCE(mp.cgst_percent,0) + COALESCE(mp.sgst_percent,0)) / 100)
                               * COALESCE(mp.cgst_percent,0) / 100, 3)
                        ELSE 0
                      END,
    cs.sgst_amount  = CASE
                        WHEN COALESCE(mp.sgst_percent, 0) > 0
                        THEN ROUND(
                               cs.amount / (1 + (COALESCE(mp.cgst_percent,0) + COALESCE(mp.sgst_percent,0)) / 100)
                               * COALESCE(mp.sgst_percent,0) / 100, 3)
                        ELSE 0
                      END
WHERE cs.cgst_percent IS NULL;

SET @disable_triggers = 0;

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SHOW TRIGGERS WHERE `Table` IN ('t_credits', 't_cashsales') AND Timing = 'BEFORE';

SELECT 't_credits backfill' AS tbl,
       SUM(CASE WHEN cgst_percent > 0 THEN 1 ELSE 0 END) AS gst_rows,
       SUM(CASE WHEN cgst_percent = 0 THEN 1 ELSE 0 END) AS non_gst_rows
FROM t_credits
UNION ALL
SELECT 't_cashsales backfill',
       SUM(CASE WHEN cgst_percent > 0 THEN 1 ELSE 0 END),
       SUM(CASE WHEN cgst_percent = 0 THEN 1 ELSE 0 END)
FROM t_cashsales;
