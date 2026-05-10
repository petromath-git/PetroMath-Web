-- Migration: Switch stock balance function + summary procedure to use day bill
-- instead of t_reading (meter) for is_tank_product=1 products.
--
-- Sales sources are now unified to 3:
--   1. t_day_bill_items  — cash + digital metered portion  (is_tank_product=1)
--   2. t_cashsales       — directly billed cash sales      (all products)
--   3. t_credits         — credit customer sales           (all products)
--   Plus t_2toil for lube products.
--
-- This eliminates the double-counting that occurred when metered credit fills
-- appeared in both t_reading and t_credits for is_lube_product=1 + is_tank_product=1
-- products (e.g. MAK ADBLUE - LOOSE).
--
-- Prerequisite: day bill backfill must be complete for all locations from their
-- respective stock_start_date.
--
-- Run order:
--   1. DROP/CREATE get_closing_product_stock_balance
--   2. DROP/CREATE get_all_products_stock_summary

-- ─── 1. get_closing_product_stock_balance ─────────────────────────────────────

DROP FUNCTION IF EXISTS `get_closing_product_stock_balance`;

DELIMITER ;;
CREATE DEFINER=`petromath_prod`@`%` FUNCTION `get_closing_product_stock_balance`(
    p_product_id       INT,
    p_location_code    VARCHAR(50),
    p_closing_bal_date DATE
) RETURNS decimal(15,2)
BEGIN
    DECLARE l_stock_start_date  DATE;
    DECLARE l_is_tank_product   TINYINT DEFAULT 0;
    DECLARE l_is_lube_product   TINYINT DEFAULT 0;
    DECLARE l_total_purchases   DECIMAL(15,2) DEFAULT 0;
    DECLARE l_total_adj_in      DECIMAL(15,2) DEFAULT 0;
    DECLARE l_total_adj_out     DECIMAL(15,2) DEFAULT 0;
    DECLARE l_cashsales         DECIMAL(15,2) DEFAULT 0;
    DECLARE l_creditsales       DECIMAL(15,2) DEFAULT 0;
    DECLARE l_2toil             DECIMAL(15,2) DEFAULT 0;
    DECLARE l_daybill           DECIMAL(15,2) DEFAULT 0;
    DECLARE l_total_sales       DECIMAL(15,2) DEFAULT 0;
    DECLARE l_balance           DECIMAL(15,2) DEFAULT 0;

    SELECT is_tank_product, is_lube_product
    INTO   l_is_tank_product, l_is_lube_product
    FROM   m_product
    WHERE  product_id = p_product_id;

    SELECT MIN(adjustment_date) INTO l_stock_start_date
    FROM   t_lubes_stock_adjustment
    WHERE  product_id    = p_product_id
      AND  location_code = p_location_code;

    IF l_stock_start_date IS NULL OR p_closing_bal_date < l_stock_start_date THEN
        RETURN NULL;
    END IF;

    -- ── Purchases ─────────────────────────────────────────────────────────────

    IF l_is_lube_product = 1 THEN
        SELECT COALESCE(SUM(li.qty), 0)
        INTO   l_total_purchases
        FROM   t_lubes_inv_lines li
        JOIN   t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
        WHERE  li.product_id    = p_product_id
          AND  hdr.location_code = p_location_code
          AND  DATE(hdr.invoice_date) >= l_stock_start_date
          AND  DATE(hdr.invoice_date) <= p_closing_bal_date;
    ELSE
        SELECT COALESCE(SUM(
            IF(COALESCE(tid.qty_unit, 'KL') = 'KL', tid.quantity * 1000, tid.quantity)
        ), 0)
        INTO   l_total_purchases
        FROM   t_tank_invoice_dtl tid
        JOIN   t_tank_invoice ti ON tid.invoice_id = ti.id
        WHERE  tid.product_id  = p_product_id
          AND  ti.location_id  = p_location_code
          AND  DATE(ti.invoice_date) >= l_stock_start_date
          AND  DATE(ti.invoice_date) <= p_closing_bal_date;
    END IF;

    -- ── Cash sales (all stock-tracked products) ────────────────────────────────

    SELECT COALESCE(SUM(cs.qty), 0)
    INTO   l_cashsales
    FROM   t_cashsales cs
    JOIN   t_closing c ON cs.closing_id = c.closing_id
    WHERE  cs.product_id   = p_product_id
      AND  c.location_code = p_location_code
      AND  DATE(c.closing_date) >= l_stock_start_date
      AND  DATE(c.closing_date) <= p_closing_bal_date;

    -- ── Credit sales (all stock-tracked products) ──────────────────────────────

    SELECT COALESCE(SUM(tc.qty), 0)
    INTO   l_creditsales
    FROM   t_credits tc
    JOIN   t_closing c ON tc.closing_id = c.closing_id
    WHERE  tc.product_id   = p_product_id
      AND  c.location_code = p_location_code
      AND  DATE(c.closing_date) >= l_stock_start_date
      AND  DATE(c.closing_date) <= p_closing_bal_date;

    -- ── 2T oil (lube products only) ────────────────────────────────────────────

    IF l_is_lube_product = 1 THEN
        SELECT COALESCE(SUM(o.given_qty - o.returned_qty), 0)
        INTO   l_2toil
        FROM   t_2toil o
        JOIN   t_closing c ON o.closing_id = c.closing_id
        WHERE  o.product_id    = p_product_id
          AND  c.location_code = p_location_code
          AND  DATE(c.closing_date) >= l_stock_start_date
          AND  DATE(c.closing_date) <= p_closing_bal_date;
    END IF;

    -- ── Day bill (metered products: is_tank_product=1) ─────────────────────────
    --    Covers the cash + digital portion of metered sales.
    --    Credits and cashsales (deducted by the day bill procedure) are tracked
    --    separately above, so together they equal the full pump throughput.

    IF l_is_tank_product = 1 THEN
        SELECT COALESCE(SUM(tdi.quantity), 0)
        INTO   l_daybill
        FROM   t_day_bill tdb
        JOIN   t_day_bill_header tdbh ON tdbh.day_bill_id = tdb.day_bill_id
        JOIN   t_day_bill_items  tdi  ON tdi.header_id    = tdbh.header_id
        WHERE  tdi.product_id    = p_product_id
          AND  tdb.location_code = p_location_code
          AND  tdb.bill_date    >= l_stock_start_date
          AND  tdb.bill_date    <= p_closing_bal_date;
    END IF;

    SET l_total_sales = l_cashsales + l_creditsales + l_2toil + l_daybill;

    -- ── Adjustments ────────────────────────────────────────────────────────────

    SELECT COALESCE(SUM(qty), 0)
    INTO   l_total_adj_in
    FROM   t_lubes_stock_adjustment
    WHERE  product_id      = p_product_id
      AND  location_code   = p_location_code
      AND  adjustment_type IN ('IN', 'OPENING')
      AND  DATE(adjustment_date) >= l_stock_start_date
      AND  DATE(adjustment_date) <= p_closing_bal_date;

    SELECT COALESCE(SUM(qty), 0)
    INTO   l_total_adj_out
    FROM   t_lubes_stock_adjustment
    WHERE  product_id      = p_product_id
      AND  location_code   = p_location_code
      AND  adjustment_type = 'OUT'
      AND  DATE(adjustment_date) >= l_stock_start_date
      AND  DATE(adjustment_date) <= p_closing_bal_date;

    SET l_balance = l_total_purchases + l_total_adj_in - l_total_sales - l_total_adj_out;

    RETURN l_balance;
END ;;
DELIMITER ;


-- ─── 2. get_all_products_stock_summary ───────────────────────────────────────

DROP PROCEDURE IF EXISTS `get_all_products_stock_summary`;

DELIMITER ;;
CREATE DEFINER=`petromath_prod`@`%` PROCEDURE `get_all_products_stock_summary`(
    IN p_location_code VARCHAR(50),
    IN p_from_date     DATE,
    IN p_to_date       DATE
)
BEGIN
    DECLARE l_opening_date DATE;
    SET l_opening_date = DATE_SUB(p_from_date, INTERVAL 1 DAY);

    SELECT
        p.product_id,
        p.product_name,
        p.unit,
        p.is_tank_product,
        p.is_lube_product,

        -- ── Opening balance ───────────────────────────────────────────────────
        COALESCE(
            get_closing_product_stock_balance(p.product_id, p_location_code, l_opening_date),
            (SELECT SUM(qty)
             FROM t_lubes_stock_adjustment
             WHERE product_id    = p.product_id
               AND location_code = p_location_code
               AND adjustment_type = 'OPENING'
               AND DATE(adjustment_date) = p_from_date)
        ) AS opening_balance,

        -- ── Closing balance ───────────────────────────────────────────────────
        get_closing_product_stock_balance(p.product_id, p_location_code, p_to_date) AS closing_balance,

        -- ── Opening price ─────────────────────────────────────────────────────
        COALESCE(
            CASE WHEN p.is_lube_product = 0 AND p.is_tank_product = 1 THEN
                (SELECT r.price
                 FROM t_reading r
                 JOIN t_closing c  ON r.closing_id = c.closing_id
                 JOIN m_pump mp    ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                 WHERE mp.product_code = p.product_name
                   AND c.location_code = p_location_code
                   AND DATE(c.closing_date) <= l_opening_date
                 ORDER BY c.closing_date DESC, r.reading_id DESC
                 LIMIT 1)
            ELSE
                (SELECT li.net_rate
                 FROM t_lubes_inv_lines li
                 JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                 WHERE li.product_id    = p.product_id
                   AND hdr.location_code = p_location_code
                   AND DATE(hdr.invoice_date) <= l_opening_date
                 ORDER BY hdr.invoice_date DESC
                 LIMIT 1)
            END
        , 0) AS opening_price,

        -- ── Closing price ─────────────────────────────────────────────────────
        COALESCE(
            CASE WHEN p.is_lube_product = 0 AND p.is_tank_product = 1 THEN
                (SELECT r.price
                 FROM t_reading r
                 JOIN t_closing c  ON r.closing_id = c.closing_id
                 JOIN m_pump mp    ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                 WHERE mp.product_code = p.product_name
                   AND c.location_code = p_location_code
                   AND DATE(c.closing_date) <= p_to_date
                 ORDER BY c.closing_date DESC, r.reading_id DESC
                 LIMIT 1)
            ELSE
                (SELECT li.net_rate
                 FROM t_lubes_inv_lines li
                 JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                 WHERE li.product_id    = p.product_id
                   AND hdr.location_code = p_location_code
                   AND DATE(hdr.invoice_date) <= p_to_date
                 ORDER BY hdr.invoice_date DESC
                 LIMIT 1)
            END
        , 0) AS closing_price,

        -- ── Total IN (qty) ────────────────────────────────────────────────────
        COALESCE((
            SELECT SUM(qty) FROM (

                -- Lube invoices (is_lube_product=1)
                SELECT li.qty AS qty
                FROM t_lubes_inv_lines li
                JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                WHERE li.product_id    = p.product_id
                  AND hdr.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(hdr.invoice_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- Fuel invoices (fuel only: is_tank_product=1, is_lube_product=0)
                SELECT IF(COALESCE(tid.qty_unit, 'KL') = 'KL', tid.quantity * 1000, tid.quantity) AS qty
                FROM t_tank_invoice_dtl tid
                JOIN t_tank_invoice ti ON tid.invoice_id = ti.id
                WHERE tid.product_id    = p.product_id
                  AND ti.location_id    = p_location_code
                  AND p.is_tank_product = 1
                  AND p.is_lube_product = 0
                  AND DATE(ti.invoice_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- Adjustments IN (all products)
                SELECT qty
                FROM t_lubes_stock_adjustment
                WHERE product_id      = p.product_id
                  AND location_code   = p_location_code
                  AND adjustment_type = 'IN'
                  AND DATE(adjustment_date) BETWEEN p_from_date AND p_to_date

            ) AS ins
        ), 0) AS total_in,

        -- ── Purchase value ────────────────────────────────────────────────────
        COALESCE((
            SELECT SUM(amt) FROM (

                SELECT (li.qty * li.net_rate) AS amt
                FROM t_lubes_inv_lines li
                JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                WHERE li.product_id    = p.product_id
                  AND hdr.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(hdr.invoice_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                SELECT trd.amount AS amt
                FROM t_tank_stk_rcpt_dtl trd
                JOIN t_tank_stk_rcpt tr ON trd.ttank_id = tr.ttank_id
                JOIN m_tank t           ON trd.tank_id  = t.tank_id
                WHERE t.product_code    = p.product_name
                  AND tr.location_code  = p_location_code
                  AND p.is_tank_product = 1
                  AND p.is_lube_product = 0
                  AND DATE(tr.invoice_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                SELECT tid.total_line_amount AS amt
                FROM t_tank_invoice_dtl tid
                JOIN t_tank_invoice ti ON tid.invoice_id = ti.id
                WHERE tid.product_id    = p.product_id
                  AND ti.location_id    = p_location_code
                  AND p.is_tank_product = 1
                  AND p.is_lube_product = 0
                  AND DATE(ti.invoice_date) BETWEEN p_from_date AND p_to_date

            ) AS purch_amts
        ), 0) AS purchase_value,

        -- ── Total OUT (qty) ───────────────────────────────────────────────────
        COALESCE((
            SELECT SUM(qty) FROM (

                -- Cash sales (all stock-tracked products)
                SELECT cs.qty
                FROM t_cashsales cs
                JOIN t_closing c ON cs.closing_id = c.closing_id
                WHERE cs.product_id   = p.product_id
                  AND c.location_code = p_location_code
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- Credit sales (all stock-tracked products)
                SELECT cr.qty
                FROM t_credits cr
                JOIN t_closing c ON cr.closing_id = c.closing_id
                WHERE cr.product_id   = p.product_id
                  AND c.location_code = p_location_code
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- 2T oil (lube products only)
                SELECT (o.given_qty - o.returned_qty)
                FROM t_2toil o
                JOIN t_closing c ON o.closing_id = c.closing_id
                WHERE o.product_id    = p.product_id
                  AND c.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date
                  AND (o.given_qty - o.returned_qty) > 0

                UNION ALL

                -- Day bill (metered products: is_tank_product=1)
                -- Covers cash + digital portion; credits and cashsales tracked above.
                SELECT tdi.quantity AS qty
                FROM t_day_bill tdb
                JOIN t_day_bill_header tdbh ON tdbh.day_bill_id = tdb.day_bill_id
                JOIN t_day_bill_items  tdi  ON tdi.header_id    = tdbh.header_id
                WHERE tdi.product_id    = p.product_id
                  AND tdb.location_code = p_location_code
                  AND p.is_tank_product = 1
                  AND tdb.bill_date BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- Adjustments OUT (all products)
                SELECT qty
                FROM t_lubes_stock_adjustment
                WHERE product_id      = p.product_id
                  AND location_code   = p_location_code
                  AND adjustment_type = 'OUT'
                  AND DATE(adjustment_date) BETWEEN p_from_date AND p_to_date

            ) AS outs
        ), 0) AS total_out,

        -- ── Sales value ───────────────────────────────────────────────────────
        COALESCE((
            SELECT SUM(amt) FROM (

                -- Cash sale amounts (all stock-tracked products)
                SELECT cs.amount AS amt
                FROM t_cashsales cs
                JOIN t_closing c ON cs.closing_id = c.closing_id
                WHERE cs.product_id   = p.product_id
                  AND c.location_code = p_location_code
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- Credit sale amounts (all stock-tracked products)
                SELECT cr.amount AS amt
                FROM t_credits cr
                JOIN t_closing c ON cr.closing_id = c.closing_id
                WHERE cr.product_id   = p.product_id
                  AND c.location_code = p_location_code
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- 2T oil amounts (lube only)
                SELECT ((o.given_qty - o.returned_qty) * o.price) AS amt
                FROM t_2toil o
                JOIN t_closing c ON o.closing_id = c.closing_id
                WHERE o.product_id    = p.product_id
                  AND c.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date
                  AND (o.given_qty - o.returned_qty) > 0

                UNION ALL

                -- Day bill amounts (metered products: is_tank_product=1)
                SELECT tdi.total_amount AS amt
                FROM t_day_bill tdb
                JOIN t_day_bill_header tdbh ON tdbh.day_bill_id = tdb.day_bill_id
                JOIN t_day_bill_items  tdi  ON tdi.header_id    = tdbh.header_id
                WHERE tdi.product_id    = p.product_id
                  AND tdb.location_code = p_location_code
                  AND p.is_tank_product = 1
                  AND tdb.bill_date BETWEEN p_from_date AND p_to_date

            ) AS sale_amts
        ), 0) AS sales_value

    FROM m_product p
    WHERE p.location_code = p_location_code
      AND (p.is_lube_product = 1 OR (p.is_tank_product = 1 AND p.is_lube_product = 0))
    ORDER BY p.is_lube_product ASC, p.product_name;

END ;;
DELIMITER ;
