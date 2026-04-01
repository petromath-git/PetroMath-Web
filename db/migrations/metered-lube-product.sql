-- Migration: Metered Lube Product Support
-- Adds is_lube_product flag to m_product and updates stored procedures
-- to include t_reading as a sales source for metered lube products (e.g. 2T LOOSE, MAK ADBLUE - LOOSE)
--
-- Run order:
--   1. ALTER TABLE (adds column)
--   2. UPDATE (sets values for existing rows)
--   3. DROP/CREATE get_closing_product_stock_balance
--   4. DROP/CREATE get_all_products_stock_summary

-- ─── 1. Add is_lube_product column ───────────────────────────────────────────

ALTER TABLE m_product
    ADD COLUMN is_lube_product TINYINT(1) NOT NULL DEFAULT 0
    AFTER is_tank_product;

-- ─── 2. Set is_lube_product = 1 for all products with a lube ledger account ──
--        This covers both normal lubes (is_tank_product=0) and metered lubes
--        (is_tank_product=1) like 2T LOOSE and MAK ADBLUE - LOOSE.

UPDATE m_product
SET is_lube_product = 1
WHERE ledger_account LIKE '%LUBE%';

-- ─── 3. Update get_closing_product_stock_balance ──────────────────────────────
--        Adds meter sales from t_reading as a 4th sales source.
--        For non-metered products this query returns 0 (no matching m_pump rows).

DROP FUNCTION IF EXISTS `get_closing_product_stock_balance`;

DELIMITER ;;
CREATE DEFINER=`petromath_prod`@`%` FUNCTION `get_closing_product_stock_balance`(
    p_product_id INT,
    p_location_code VARCHAR(50),
    p_closing_bal_date DATE
) RETURNS decimal(15,2)
BEGIN
    DECLARE l_stock_start_date DATE;
    DECLARE l_total_sales      DECIMAL(15,2) DEFAULT 0;
    DECLARE l_total_purchases  DECIMAL(15,2) DEFAULT 0;
    DECLARE l_total_adj_in     DECIMAL(15,2) DEFAULT 0;
    DECLARE l_total_adj_out    DECIMAL(15,2) DEFAULT 0;
    DECLARE l_cashsales        DECIMAL(15,2) DEFAULT 0;
    DECLARE l_creditsales      DECIMAL(15,2) DEFAULT 0;
    DECLARE l_2toil            DECIMAL(15,2) DEFAULT 0;
    DECLARE l_metersales       DECIMAL(15,2) DEFAULT 0;
    DECLARE l_balance          DECIMAL(15,2) DEFAULT 0;

    -- Get the stock start date (first adjustment date — serves as opening balance anchor)
    SELECT MIN(adjustment_date) INTO l_stock_start_date
    FROM t_lubes_stock_adjustment
    WHERE product_id = p_product_id
      AND location_code = p_location_code;

    -- If no stock start date or query date is before start date, return NULL
    IF l_stock_start_date IS NULL OR p_closing_bal_date < l_stock_start_date THEN
        RETURN NULL;
    END IF;

    -- Cash sales
    SELECT COALESCE(SUM(cs.qty), 0)
    INTO l_cashsales
    FROM t_cashsales cs
    JOIN t_closing c ON cs.closing_id = c.closing_id
    WHERE cs.product_id = p_product_id
      AND c.location_code = p_location_code
      AND DATE(c.closing_date) >= l_stock_start_date
      AND DATE(c.closing_date) <= p_closing_bal_date;

    -- Credit sales
    SELECT COALESCE(SUM(tc.qty), 0)
    INTO l_creditsales
    FROM t_credits tc
    JOIN t_closing c ON tc.closing_id = c.closing_id
    WHERE tc.product_id = p_product_id
      AND c.location_code = p_location_code
      AND DATE(c.closing_date) >= l_stock_start_date
      AND DATE(c.closing_date) <= p_closing_bal_date;

    -- 2T oil (given - returned)
    SELECT COALESCE(SUM(o.given_qty - o.returned_qty), 0)
    INTO l_2toil
    FROM t_2toil o
    JOIN t_closing c ON o.closing_id = c.closing_id
    WHERE o.product_id = p_product_id
      AND c.location_code = p_location_code
      AND DATE(c.closing_date) >= l_stock_start_date
      AND DATE(c.closing_date) <= p_closing_bal_date;

    -- Meter sales (for metered lube products like 2T LOOSE and MAK ADBLUE - LOOSE)
    -- For non-metered products this returns 0 because no m_pump row will match.
    SELECT COALESCE(SUM(r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)), 0)
    INTO l_metersales
    FROM t_reading r
    JOIN t_closing c ON r.closing_id = c.closing_id
    JOIN m_pump mp ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
    JOIN m_product prod ON mp.product_code = prod.product_name AND prod.product_id = p_product_id
    WHERE c.location_code = p_location_code
      AND DATE(c.closing_date) >= l_stock_start_date
      AND DATE(c.closing_date) <= p_closing_bal_date
      AND (r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) > 0;

    SET l_total_sales = COALESCE(l_cashsales, 0)
                      + COALESCE(l_creditsales, 0)
                      + COALESCE(l_2toil, 0)
                      + COALESCE(l_metersales, 0);

    -- Purchases
    SELECT COALESCE(SUM(li.qty), 0)
    INTO l_total_purchases
    FROM t_lubes_inv_lines li
    JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
    WHERE li.product_id = p_product_id
      AND hdr.location_code = p_location_code
      AND DATE(hdr.invoice_date) >= l_stock_start_date
      AND DATE(hdr.invoice_date) <= p_closing_bal_date;

    -- Adjustments IN
    SELECT COALESCE(SUM(qty), 0)
    INTO l_total_adj_in
    FROM t_lubes_stock_adjustment
    WHERE product_id = p_product_id
      AND location_code = p_location_code
      AND adjustment_type = 'IN'
      AND DATE(adjustment_date) >= l_stock_start_date
      AND DATE(adjustment_date) <= p_closing_bal_date;

    -- Adjustments OUT
    SELECT COALESCE(SUM(qty), 0)
    INTO l_total_adj_out
    FROM t_lubes_stock_adjustment
    WHERE product_id = p_product_id
      AND location_code = p_location_code
      AND adjustment_type = 'OUT'
      AND DATE(adjustment_date) >= l_stock_start_date
      AND DATE(adjustment_date) <= p_closing_bal_date;

    SET l_balance = COALESCE(l_total_purchases, 0)
                  + COALESCE(l_total_adj_in, 0)
                  - COALESCE(l_total_sales, 0)
                  - COALESCE(l_total_adj_out, 0);

    RETURN l_balance;
END ;;
DELIMITER ;

-- ─── 4. Update get_all_products_stock_summary ─────────────────────────────────
--        Changes the product filter from "NOT IN m_pump" to is_lube_product = 1
--        and adds meter sales as an OUT source.

DROP PROCEDURE IF EXISTS `get_all_products_stock_summary`;

DELIMITER ;;
CREATE DEFINER=`petromath_prod`@`%` PROCEDURE `get_all_products_stock_summary`(
    IN p_location_code VARCHAR(50),
    IN p_from_date DATE,
    IN p_to_date DATE
)
BEGIN
    DECLARE l_opening_date DATE;
    SET l_opening_date = DATE_SUB(p_from_date, INTERVAL 1 DAY);

    SELECT
        p.product_id,
        p.product_name,
        p.unit,
        get_closing_product_stock_balance(p.product_id, p_location_code, l_opening_date) AS opening_balance,
        get_closing_product_stock_balance(p.product_id, p_location_code, p_to_date)      AS closing_balance,

        -- IN transactions
        COALESCE((
            SELECT SUM(qty) FROM (
                -- Purchases
                SELECT li.qty AS qty
                FROM t_lubes_inv_lines li
                JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                WHERE li.product_id = p.product_id
                  AND hdr.location_code = p_location_code
                  AND DATE(hdr.invoice_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- Adjustments IN
                SELECT qty
                FROM t_lubes_stock_adjustment
                WHERE product_id = p.product_id
                  AND location_code = p_location_code
                  AND adjustment_type = 'IN'
                  AND DATE(adjustment_date) BETWEEN p_from_date AND p_to_date
            ) AS ins
        ), 0) AS total_in,

        -- OUT transactions
        COALESCE((
            SELECT SUM(qty) FROM (
                -- Cash sales
                SELECT cs.qty
                FROM t_cashsales cs
                JOIN t_closing c ON cs.closing_id = c.closing_id
                WHERE cs.product_id = p.product_id
                  AND c.location_code = p_location_code
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- Credit sales
                SELECT cr.qty
                FROM t_credits cr
                JOIN t_closing c ON cr.closing_id = c.closing_id
                WHERE cr.product_id = p.product_id
                  AND c.location_code = p_location_code
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- 2T oil
                SELECT (o.given_qty - o.returned_qty)
                FROM t_2toil o
                JOIN t_closing c ON o.closing_id = c.closing_id
                WHERE o.product_id = p.product_id
                  AND c.location_code = p_location_code
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date
                  AND (o.given_qty - o.returned_qty) > 0

                UNION ALL

                -- Meter sales (metered lube products like 2T LOOSE and MAK ADBLUE - LOOSE)
                -- Returns nothing for non-metered products (no m_pump row will match)
                SELECT (r.closing_reading - r.opening_reading - COALESCE(r.testing, 0))
                FROM t_reading r
                JOIN t_closing c ON r.closing_id = c.closing_id
                JOIN m_pump mp ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                WHERE mp.product_code = p.product_name
                  AND c.location_code = p_location_code
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date
                  AND (r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) > 0

                UNION ALL

                -- Adjustments OUT
                SELECT qty
                FROM t_lubes_stock_adjustment
                WHERE product_id = p.product_id
                  AND location_code = p_location_code
                  AND adjustment_type = 'OUT'
                  AND DATE(adjustment_date) BETWEEN p_from_date AND p_to_date
            ) AS outs
        ), 0) AS total_out

    FROM m_product p
    WHERE p.location_code = p_location_code
      AND p.is_lube_product = 1
    ORDER BY p.product_name;
END ;;
DELIMITER ;
