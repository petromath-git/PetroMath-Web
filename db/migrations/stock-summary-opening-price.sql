-- Migration: Fix opening_price in get_all_products_stock_summary
-- Opening price now uses closest known rate:
--   1. Last rate on or before (from_date - 1)  [backward]
--   2. If none, first rate on or after from_date [forward fallback]
-- Same logic for closing_price (first rate before to_date, fallback to first after).

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
             WHERE product_id = p.product_id
               AND location_code = p_location_code
               AND adjustment_type = 'OPENING'
               AND DATE(adjustment_date) = p_from_date)
        ) AS opening_balance,

        -- ── Closing balance ───────────────────────────────────────────────────
        get_closing_product_stock_balance(p.product_id, p_location_code, p_to_date) AS closing_balance,

        -- ── Opening price: last known rate on/before opening_date,
        --                   fallback to first rate on/after from_date
        COALESCE(
            CASE WHEN p.is_lube_product = 0 AND p.is_tank_product = 1 THEN
                COALESCE(
                    (SELECT r.price
                     FROM t_reading r
                     JOIN t_closing c  ON r.closing_id = c.closing_id
                     JOIN m_pump mp    ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                     WHERE mp.product_code = p.product_name
                       AND c.location_code = p_location_code
                       AND DATE(c.closing_date) <= l_opening_date
                     ORDER BY c.closing_date DESC, r.reading_id DESC
                     LIMIT 1),
                    (SELECT r.price
                     FROM t_reading r
                     JOIN t_closing c  ON r.closing_id = c.closing_id
                     JOIN m_pump mp    ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                     WHERE mp.product_code = p.product_name
                       AND c.location_code = p_location_code
                       AND DATE(c.closing_date) >= p_from_date
                     ORDER BY c.closing_date ASC, r.reading_id ASC
                     LIMIT 1)
                )
            ELSE
                COALESCE(
                    (SELECT li.net_rate
                     FROM t_lubes_inv_lines li
                     JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                     WHERE li.product_id = p.product_id
                       AND hdr.location_code = p_location_code
                       AND DATE(hdr.invoice_date) <= l_opening_date
                     ORDER BY hdr.invoice_date DESC
                     LIMIT 1),
                    (SELECT li.net_rate
                     FROM t_lubes_inv_lines li
                     JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                     WHERE li.product_id = p.product_id
                       AND hdr.location_code = p_location_code
                       AND DATE(hdr.invoice_date) >= p_from_date
                     ORDER BY hdr.invoice_date ASC
                     LIMIT 1)
                )
            END
        , 0) AS opening_price,

        -- ── Closing price: last known rate on/before to_date,
        --                   fallback to first rate on/after to_date
        COALESCE(
            CASE WHEN p.is_lube_product = 0 AND p.is_tank_product = 1 THEN
                COALESCE(
                    (SELECT r.price
                     FROM t_reading r
                     JOIN t_closing c  ON r.closing_id = c.closing_id
                     JOIN m_pump mp    ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                     WHERE mp.product_code = p.product_name
                       AND c.location_code = p_location_code
                       AND DATE(c.closing_date) <= p_to_date
                     ORDER BY c.closing_date DESC, r.reading_id DESC
                     LIMIT 1),
                    (SELECT r.price
                     FROM t_reading r
                     JOIN t_closing c  ON r.closing_id = c.closing_id
                     JOIN m_pump mp    ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                     WHERE mp.product_code = p.product_name
                       AND c.location_code = p_location_code
                       AND DATE(c.closing_date) > p_to_date
                     ORDER BY c.closing_date ASC, r.reading_id ASC
                     LIMIT 1)
                )
            ELSE
                COALESCE(
                    (SELECT li.net_rate
                     FROM t_lubes_inv_lines li
                     JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                     WHERE li.product_id = p.product_id
                       AND hdr.location_code = p_location_code
                       AND DATE(hdr.invoice_date) <= p_to_date
                     ORDER BY hdr.invoice_date DESC
                     LIMIT 1),
                    (SELECT li.net_rate
                     FROM t_lubes_inv_lines li
                     JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                     WHERE li.product_id = p.product_id
                       AND hdr.location_code = p_location_code
                       AND DATE(hdr.invoice_date) > p_to_date
                     ORDER BY hdr.invoice_date ASC
                     LIMIT 1)
                )
            END
        , 0) AS closing_price,

        -- ── Total IN (qty) ────────────────────────────────────────────────────
        COALESCE((
            SELECT SUM(qty) FROM (

                SELECT li.qty AS qty
                FROM t_lubes_inv_lines li
                JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                WHERE li.product_id = p.product_id
                  AND hdr.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(hdr.invoice_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                SELECT trd.quantity * 1000 AS qty
                FROM t_tank_stk_rcpt_dtl trd
                JOIN t_tank_stk_rcpt tr ON trd.ttank_id = tr.ttank_id
                JOIN m_tank t           ON trd.tank_id  = t.tank_id
                WHERE t.product_code    = p.product_name
                  AND tr.location_code  = p_location_code
                  AND p.is_tank_product = 1
                  AND p.is_lube_product = 0
                  AND DATE(tr.invoice_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                -- Fuel invoices (fuel only: is_tank_product=1, is_lube_product=0)
                SELECT tid.quantity * 1000 AS qty
                FROM t_tank_invoice_dtl tid
                JOIN t_tank_invoice ti ON tid.invoice_id = ti.id
                WHERE tid.product_id   = p.product_id
                  AND ti.location_id   = p_location_code
                  AND p.is_tank_product = 1
                  AND p.is_lube_product = 0
                  AND DATE(ti.invoice_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                SELECT qty
                FROM t_lubes_stock_adjustment
                WHERE product_id     = p.product_id
                  AND location_code  = p_location_code
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
                WHERE li.product_id = p.product_id
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

                -- Fuel invoice amounts (fuel only)
                SELECT tid.total_line_amount AS amt
                FROM t_tank_invoice_dtl tid
                JOIN t_tank_invoice ti ON tid.invoice_id = ti.id
                WHERE tid.product_id   = p.product_id
                  AND ti.location_id   = p_location_code
                  AND p.is_tank_product = 1
                  AND p.is_lube_product = 0
                  AND DATE(ti.invoice_date) BETWEEN p_from_date AND p_to_date

            ) AS purch_amts
        ), 0) AS purchase_value,

        -- ── Total OUT (qty) ───────────────────────────────────────────────────
        COALESCE((
            SELECT SUM(qty) FROM (

                SELECT cs.qty
                FROM t_cashsales cs
                JOIN t_closing c ON cs.closing_id = c.closing_id
                WHERE cs.product_id   = p.product_id
                  AND c.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                SELECT cr.qty
                FROM t_credits cr
                JOIN t_closing c ON cr.closing_id = c.closing_id
                WHERE cr.product_id   = p.product_id
                  AND c.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                SELECT (o.given_qty - o.returned_qty)
                FROM t_2toil o
                JOIN t_closing c ON o.closing_id = c.closing_id
                WHERE o.product_id    = p.product_id
                  AND c.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date
                  AND (o.given_qty - o.returned_qty) > 0

                UNION ALL

                SELECT (r.closing_reading - r.opening_reading - COALESCE(r.testing, 0))
                FROM t_reading r
                JOIN t_closing c ON r.closing_id = c.closing_id
                JOIN m_pump mp   ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                WHERE mp.product_code  = p.product_name
                  AND c.location_code  = p_location_code
                  AND p.is_tank_product = 1
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date
                  AND (r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) > 0

                UNION ALL

                SELECT qty
                FROM t_lubes_stock_adjustment
                WHERE product_id     = p.product_id
                  AND location_code  = p_location_code
                  AND adjustment_type = 'OUT'
                  AND DATE(adjustment_date) BETWEEN p_from_date AND p_to_date

            ) AS outs
        ), 0) AS total_out,

        -- ── Sales value ───────────────────────────────────────────────────────
        COALESCE((
            SELECT SUM(amt) FROM (

                SELECT cs.amount AS amt
                FROM t_cashsales cs
                JOIN t_closing c ON cs.closing_id = c.closing_id
                WHERE cs.product_id   = p.product_id
                  AND c.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                SELECT cr.amount AS amt
                FROM t_credits cr
                JOIN t_closing c ON cr.closing_id = c.closing_id
                WHERE cr.product_id   = p.product_id
                  AND c.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date

                UNION ALL

                SELECT ((o.given_qty - o.returned_qty) * o.price) AS amt
                FROM t_2toil o
                JOIN t_closing c ON o.closing_id = c.closing_id
                WHERE o.product_id    = p.product_id
                  AND c.location_code = p_location_code
                  AND p.is_lube_product = 1
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date
                  AND (o.given_qty - o.returned_qty) > 0

                UNION ALL

                SELECT ((r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) * r.price) AS amt
                FROM t_reading r
                JOIN t_closing c ON r.closing_id = c.closing_id
                JOIN m_pump mp   ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                WHERE mp.product_code  = p.product_name
                  AND c.location_code  = p_location_code
                  AND p.is_tank_product = 1
                  AND DATE(c.closing_date) BETWEEN p_from_date AND p_to_date
                  AND (r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) > 0

            ) AS sale_amts
        ), 0) AS sales_value

    FROM m_product p
    WHERE p.location_code = p_location_code
      AND (p.is_lube_product = 1 OR (p.is_tank_product = 1 AND p.is_lube_product = 0))
    ORDER BY p.is_lube_product ASC, p.product_name;

END ;;
DELIMITER ;
