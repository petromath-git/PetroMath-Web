-- ============================================================
-- Day Bill Generation Procedure
-- Run once on each environment after day-bill-migration.sql
-- Safe to re-run: uses DROP PROCEDURE IF EXISTS
-- ============================================================

DELIMITER //

DROP PROCEDURE IF EXISTS generate_day_bill //

CREATE PROCEDURE generate_day_bill (
    IN  p_location_code  VARCHAR(50),
    IN  p_bill_date      DATE,
    IN  p_user           VARCHAR(45)
)
generate_day_bill_sp: BEGIN

    DECLARE v_day_bill_id       INT;
    DECLARE v_header_id         INT;
    DECLARE v_total_net_revenue DECIMAL(20,6) DEFAULT 0;
    DECLARE v_pump_count        INT           DEFAULT 0;
    DECLARE v_oil_count         INT           DEFAULT 0;

    -- Consolidation threshold (read from config; default 20000)
    DECLARE v_threshold         DECIMAL(15,2) DEFAULT 20000;
    DECLARE v_primary_vendor_id INT           DEFAULT NULL;
    DECLARE v_is_consolidated   TINYINT(1)    DEFAULT 0;

    -- Cursor variables for digital vendor loop
    DECLARE v_vendor_id         INT;
    DECLARE v_vendor_name       VARCHAR(255);
    DECLARE v_digital_amount    DECIMAL(15,3);
    DECLARE v_dig_header_id     INT;
    DECLARE v_done              BOOLEAN DEFAULT FALSE;

    DECLARE cur_vendors CURSOR FOR
        SELECT vendor_id, vendor_name, digital_amount FROM tmp_db_digital;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;

    -- ── Cleanup any leftover temp tables from previous call in this session ──
    DROP TEMPORARY TABLE IF EXISTS tmp_db_pump;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_oil;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_cashsale;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_intercompany;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_credit;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_digital;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_dig_items;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_bill_numbers;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_cons_dominant;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_cons_assign;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_primary_items;

    -- ── 1. Reading-product pump quantities for the day ───────────────────────
    --    Weighted-average price across all shifts closed on p_bill_date.
    --    Joined via m_pump.product_code = m_product.product_name (existing convention).
    CREATE TEMPORARY TABLE tmp_db_pump
    SELECT
        p.product_id,
        p.product_name,
        COALESCE(p.hsn_code,      '')  AS hsn_code,
        COALESCE(p.cgst_percent,  0)   AS cgst_rate,
        COALESCE(p.sgst_percent,  0)   AS sgst_rate,
        CAST(
            SUM(r.closing_reading - r.opening_reading - COALESCE(r.testing, 0))
        AS DECIMAL(12,3))  AS pumped_qty,
        CAST(
            SUM((r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) * r.price)
            / NULLIF(SUM(r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)), 0)
        AS DECIMAL(10,3))  AS price,
        CAST(0 AS DECIMAL(12,3)) AS cashsale_qty,
        CAST(0 AS DECIMAL(12,3)) AS net_qty
    FROM t_reading r
    JOIN t_closing c  ON r.closing_id = c.closing_id
    JOIN m_pump mp    ON r.pump_id = mp.pump_id
                     AND DATE(c.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
    JOIN m_product p  ON mp.product_code = p.product_name
                     AND p.location_code  = c.location_code
    WHERE c.location_code = p_location_code
      AND DATE(c.closing_date) = p_bill_date
      AND c.closing_status = 'CLOSED'
    GROUP BY p.product_id, p.product_name, p.hsn_code, p.cgst_percent, p.sgst_percent
    HAVING pumped_qty > 0;

    -- ── 2. 2T / loose oil quantities for the day ─────────────────────────────
    --    For MC/MUE/MC2/MME: 2T LOOSE is priced at DSR-OIL rate (same logic as
    --    tally_export, generate_cashflow, and report-dsr-dao).
    CREATE TEMPORARY TABLE tmp_db_oil
    SELECT
        p.product_id,
        p.product_name,
        COALESCE(p.hsn_code,      '')  AS hsn_code,
        COALESCE(p.cgst_percent,  0)   AS cgst_rate,
        COALESCE(p.sgst_percent,  0)   AS sgst_rate,
        CAST(
            SUM(ot.given_qty - COALESCE(ot.returned_qty, 0))
        AS DECIMAL(12,3))  AS qty,
        CAST(
            CASE
                WHEN p_location_code IN ('MC','MUE','MC2','MME')
                     AND UPPER(p.product_name) = '2T LOOSE'
                THEN (SELECT dsr.price
                      FROM m_product dsr
                      WHERE dsr.product_name = 'DSR - OIL'
                        AND dsr.location_code = p_location_code
                      LIMIT 1)
                ELSE SUM((ot.given_qty - COALESCE(ot.returned_qty, 0)) * ot.price)
                     / NULLIF(SUM(ot.given_qty - COALESCE(ot.returned_qty, 0)), 0)
            END
        AS DECIMAL(10,3))  AS price
    FROM t_2toil ot
    JOIN t_closing c ON ot.closing_id = c.closing_id
    JOIN m_product p ON ot.product_id = p.product_id
    WHERE c.location_code = p_location_code
      AND DATE(c.closing_date) = p_bill_date
      AND c.closing_status = 'CLOSED'
    GROUP BY p.product_id, p.product_name, p.hsn_code, p.cgst_percent, p.sgst_percent
    HAVING qty > 0;

    -- ── 3. Early exit if nothing to bill ─────────────────────────────────────
    SELECT COUNT(*) INTO v_pump_count FROM tmp_db_pump;
    SELECT COUNT(*) INTO v_oil_count  FROM tmp_db_oil;

    IF v_pump_count = 0 AND v_oil_count = 0 THEN
        DROP TEMPORARY TABLE IF EXISTS tmp_db_pump;
        DROP TEMPORARY TABLE IF EXISTS tmp_db_oil;
        LEAVE generate_day_bill_sp;
    END IF;

    -- ── 4. Cash-sale quantities for reading products (already individually billed) ──
    --    These are subtracted from pumped_qty so they are not double-counted.
    CREATE TEMPORARY TABLE tmp_db_cashsale
    SELECT
        cs.product_id,
        CAST(SUM(cs.qty) AS DECIMAL(12,3)) AS cashsale_qty
    FROM t_cashsales cs
    JOIN t_closing c ON cs.closing_id = c.closing_id
    WHERE c.location_code = p_location_code
      AND DATE(c.closing_date) = p_bill_date
      AND c.closing_status = 'CLOSED'
      AND cs.product_id IN (SELECT product_id FROM tmp_db_pump)
    GROUP BY cs.product_id;

    -- ── 4b. Intercompany fill quantities (bowser fills — excluded from billable qty) ──
    --     Bowser fills at the SFS nozzle appear in pumped_qty but are NOT
    --     sold to any retail customer; they must be subtracted like cashsales.
    CREATE TEMPORARY TABLE tmp_db_intercompany
    SELECT
        tci.product_id,
        CAST(SUM(tci.quantity) AS DECIMAL(12,3)) AS intercompany_qty
    FROM t_closing_intercompany tci
    JOIN t_closing c ON tci.closing_id = c.closing_id
    WHERE c.location_code = p_location_code
      AND DATE(c.closing_date) = p_bill_date
      AND c.closing_status = 'CLOSED'
      AND tci.product_id IN (SELECT product_id FROM tmp_db_pump)
    GROUP BY tci.product_id;

    -- ── 5. Compute net_qty = pumped - cashsales - intercompany (floor at 0) ─────
    UPDATE tmp_db_pump p
    LEFT  JOIN tmp_db_cashsale cs     ON p.product_id = cs.product_id
    LEFT  JOIN tmp_db_intercompany ic ON p.product_id = ic.product_id
    SET   p.cashsale_qty = COALESCE(cs.cashsale_qty, 0),
          p.net_qty      = GREATEST(0, p.pumped_qty
                                       - COALESCE(cs.cashsale_qty, 0)
                                       - COALESCE(ic.intercompany_qty, 0));

    -- ── 6. Total net revenue (denominator for digital split) ─────────────────
    SELECT COALESCE(SUM(net_qty * price), 0)
    INTO   v_total_net_revenue
    FROM   tmp_db_pump
    WHERE  price > 0;

    -- ── 7. Digital vendor totals for the day ─────────────────────────────────
    CREATE TEMPORARY TABLE tmp_db_digital
    SELECT
        ds.vendor_id,
        cl.Company_Name                         AS vendor_name,
        CAST(SUM(ds.amount) AS DECIMAL(15,3))   AS digital_amount
    FROM t_digital_sales ds
    JOIN t_closing c     ON ds.closing_id = c.closing_id
    JOIN m_credit_list cl ON ds.vendor_id = cl.creditlist_id
    WHERE c.location_code = p_location_code
      AND DATE(c.closing_date) = p_bill_date
      AND c.closing_status = 'CLOSED'
    GROUP BY ds.vendor_id, cl.Company_Name;

    -- ── 7b. Read consolidation threshold from location config ─────────────────
    --    DAY_BILL_CONSOLIDATE_THRESHOLD: vendors at or below this amount get a
    --    single-product (dominant product) bill. Default 20000.
    SELECT CAST(setting_value AS DECIMAL(15,2)) INTO v_threshold
    FROM m_location_config
    WHERE setting_name = 'DAY_BILL_CONSOLIDATE_THRESHOLD'
      AND location_code IN (p_location_code, '*')
      AND CURDATE() BETWEEN effective_start_date AND effective_end_date
    ORDER BY CASE WHEN location_code = p_location_code THEN 0 ELSE 1 END
    LIMIT 1;

    -- Primary vendor: largest above threshold; if none above threshold, just the largest.
    -- Primary gets the full multi-product breakdown and absorbs redistribution.
    SELECT vendor_id INTO v_primary_vendor_id
    FROM tmp_db_digital
    ORDER BY CASE WHEN digital_amount > v_threshold THEN 0 ELSE 1 END ASC,
             digital_amount DESC
    LIMIT 1;

    -- ── 8. Credit quantities for the day ────────────────────────────────────
    CREATE TEMPORARY TABLE tmp_db_credit
    SELECT
        tc.product_id,
        CAST(SUM(tc.qty) AS DECIMAL(12,3)) AS credit_qty
    FROM t_credits tc
    JOIN t_closing c ON tc.closing_id = c.closing_id
    WHERE c.location_code = p_location_code
      AND DATE(c.closing_date) = p_bill_date
      AND c.closing_status = 'CLOSED'
    GROUP BY tc.product_id;

    -- ── 9. Proportionate digital items ───────────────────────────────────────
    --    digital_qty[V,P] = (net_revenue[P] / total_net_revenue) × (vendor_amt[V] / price[P])
    CREATE TEMPORARY TABLE tmp_db_dig_items
    SELECT
        d.vendor_id,
        p.product_id,
        CAST(
            CASE
                WHEN v_total_net_revenue > 0 AND p.price > 0
                THEN (p.net_qty * p.price / v_total_net_revenue) * (d.digital_amount / p.price)
                ELSE 0
            END
        AS DECIMAL(12,6)) AS digital_qty
    FROM tmp_db_digital  d
    CROSS JOIN tmp_db_pump p;

    -- ── 9b. Build consolidated-vendor tables ─────────────────────────────────
    --    For each vendor ≤ threshold (and not the primary), find their dominant
    --    product (highest proportionate value) — they will be billed on that
    --    product only.
    CREATE TEMPORARY TABLE tmp_db_cons_dominant
    SELECT ranked.vendor_id, ranked.product_id AS dom_product_id, ranked.price AS dom_price
    FROM (
        SELECT
            di.vendor_id,
            di.product_id,
            p.price,
            ROW_NUMBER() OVER (PARTITION BY di.vendor_id
                               ORDER BY (di.digital_qty * p.price) DESC) AS rn
        FROM tmp_db_dig_items di
        JOIN tmp_db_pump p     ON di.product_id = p.product_id
        JOIN tmp_db_digital d  ON di.vendor_id  = d.vendor_id
        WHERE d.digital_amount <= v_threshold
          AND di.vendor_id <> v_primary_vendor_id
    ) ranked
    WHERE rn = 1;

    -- Single-product assignment for each consolidated vendor:
    --   qty = vendor_amount / dominant_price  (so qty × price = vendor_amount exactly)
    CREATE TEMPORARY TABLE tmp_db_cons_assign
    SELECT
        cd.vendor_id,
        cd.dom_product_id AS product_id,
        CAST(d.digital_amount / cd.dom_price AS DECIMAL(12,6)) AS qty
    FROM tmp_db_cons_dominant cd
    JOIN tmp_db_digital d ON cd.vendor_id = d.vendor_id;

    -- Pre-calculate primary vendor adjusted quantities.
    -- MySQL cannot open the same temp table twice in one query (error 1137),
    -- so we materialise the result here before the vendor loop.
    CREATE TEMPORARY TABLE tmp_db_primary_items
    SELECT
        p2.product_id,
        p2.price,
        p2.cgst_rate,
        p2.sgst_rate,
        GREATEST(0,
            COALESCE(SUM(CASE WHEN di.vendor_id = v_primary_vendor_id THEN di.digital_qty ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN di.vendor_id IN (SELECT vendor_id FROM tmp_db_cons_dominant)
                                THEN di.digital_qty ELSE 0 END), 0)
            - COALESCE(
                (SELECT SUM(ca.qty) FROM tmp_db_cons_assign ca WHERE ca.product_id = p2.product_id),
                0)
        ) AS adjusted_qty
    FROM tmp_db_pump p2
    LEFT JOIN tmp_db_dig_items di ON di.product_id = p2.product_id
    GROUP BY p2.product_id, p2.price, p2.cgst_rate, p2.sgst_rate;

    -- ── 10. Upsert t_day_bill parent row ────────────────────────────────────
    INSERT INTO t_day_bill (location_code, bill_date, status,
                            created_by, creation_date, updated_by, updation_date)
    VALUES (p_location_code, p_bill_date, 'ACTIVE',
            p_user, NOW(), p_user, NOW())
    ON DUPLICATE KEY UPDATE
        updated_by    = p_user,
        updation_date = NOW();

    SELECT day_bill_id INTO v_day_bill_id
    FROM   t_day_bill
    WHERE  location_code = p_location_code AND bill_date = p_bill_date;

    -- ── 11. Preserve existing bill numbers ───────────────────────────────────
    CREATE TEMPORARY TABLE tmp_db_bill_numbers
    SELECT
        CONCAT(bill_type, ':', COALESCE(vendor_id, 'null')) AS bill_key,
        bill_number
    FROM t_day_bill_header
    WHERE day_bill_id = v_day_bill_id AND bill_number IS NOT NULL AND bill_number <> '';

    -- ── 12. Wipe old headers (items cascade via FK ON DELETE CASCADE) ─────────
    DELETE FROM t_day_bill_header WHERE day_bill_id = v_day_bill_id;

    -- ── 13. Insert CASH header ───────────────────────────────────────────────
    INSERT INTO t_day_bill_header (day_bill_id, bill_type, vendor_id, bill_number,
                                   total_amount, created_by, creation_date, updated_by, updation_date)
    VALUES (v_day_bill_id, 'CASH', NULL,
            (SELECT bill_number FROM tmp_db_bill_numbers WHERE bill_key = 'CASH:null' LIMIT 1),
            0, p_user, NOW(), p_user, NOW());

    SET v_header_id = LAST_INSERT_ID();

    -- ── 14. CASH items — reading products ────────────────────────────────────
    INSERT INTO t_day_bill_items (header_id, product_id, quantity, rate,
                                  taxable_amount, cgst_rate, cgst_amount,
                                  sgst_rate, sgst_amount, total_amount)
    SELECT
        v_header_id,
        p.product_id,
        ROUND(cash_qty, 3)                                                          AS quantity,
        ROUND(p.price, 3)                                                           AS rate,
        ROUND(
            CASE WHEN (p.cgst_rate + p.sgst_rate) > 0
                 THEN cash_qty * p.price / (1 + (p.cgst_rate + p.sgst_rate) / 100)
                 ELSE cash_qty * p.price END, 3)                                    AS taxable_amount,
        p.cgst_rate,
        ROUND(
            CASE WHEN (p.cgst_rate + p.sgst_rate) > 0
                 THEN (cash_qty * p.price / (1 + (p.cgst_rate + p.sgst_rate) / 100)) * p.cgst_rate / 100
                 ELSE 0 END, 3)                                                     AS cgst_amount,
        p.sgst_rate,
        ROUND(
            CASE WHEN (p.cgst_rate + p.sgst_rate) > 0
                 THEN (cash_qty * p.price / (1 + (p.cgst_rate + p.sgst_rate) / 100)) * p.sgst_rate / 100
                 ELSE 0 END, 3)                                                     AS sgst_amount,
        ROUND(cash_qty * p.price, 3)                                                AS total_amount
    FROM (
        SELECT
            p.product_id, p.price, p.cgst_rate, p.sgst_rate,
            GREATEST(0,
                p.net_qty
                - COALESCE(cr.credit_qty, 0)
                - COALESCE((SELECT SUM(di.digital_qty) FROM tmp_db_dig_items di
                             WHERE di.product_id = p.product_id), 0)
            ) AS cash_qty
        FROM tmp_db_pump p
        LEFT JOIN tmp_db_credit cr ON p.product_id = cr.product_id
    ) p
    WHERE cash_qty > 0;

    -- ── 15. CASH items — 2T oil (all cash, no digital/credit deduction) ──────
    INSERT INTO t_day_bill_items (header_id, product_id, quantity, rate,
                                  taxable_amount, cgst_rate, cgst_amount,
                                  sgst_rate, sgst_amount, total_amount)
    SELECT
        v_header_id,
        o.product_id,
        ROUND(o.qty, 3),
        ROUND(o.price, 3),
        ROUND(
            CASE WHEN (o.cgst_rate + o.sgst_rate) > 0
                 THEN o.qty * o.price / (1 + (o.cgst_rate + o.sgst_rate) / 100)
                 ELSE o.qty * o.price END, 3),
        o.cgst_rate,
        ROUND(
            CASE WHEN (o.cgst_rate + o.sgst_rate) > 0
                 THEN (o.qty * o.price / (1 + (o.cgst_rate + o.sgst_rate) / 100)) * o.cgst_rate / 100
                 ELSE 0 END, 3),
        o.sgst_rate,
        ROUND(
            CASE WHEN (o.cgst_rate + o.sgst_rate) > 0
                 THEN (o.qty * o.price / (1 + (o.cgst_rate + o.sgst_rate) / 100)) * o.sgst_rate / 100
                 ELSE 0 END, 3),
        ROUND(o.qty * o.price, 3)
    FROM tmp_db_oil o
    WHERE o.qty > 0;

    -- ── 16. Update CASH header total ─────────────────────────────────────────
    UPDATE t_day_bill_header
    SET    total_amount = (SELECT COALESCE(SUM(total_amount), 0)
                           FROM   t_day_bill_items
                           WHERE  header_id = v_header_id)
    WHERE  header_id = v_header_id;

    -- ── 17. DIGITAL headers + items (one per vendor) ─────────────────────────
    --
    --  Three cases per vendor:
    --    A. Consolidated (≤ threshold, not primary): single dominant-product line,
    --       qty = vendor_amount / dom_price, total = vendor_amount (exact).
    --    B. Primary (largest / highest above threshold): absorbs residual quantities
    --       from consolidated vendors while keeping all products.
    --    C. Normal above-threshold (not primary): unchanged proportionate split.
    --
    OPEN cur_vendors;
    vendor_loop: LOOP
        FETCH cur_vendors INTO v_vendor_id, v_vendor_name, v_digital_amount;
        IF v_done THEN LEAVE vendor_loop; END IF;

        SET v_is_consolidated = IF(v_digital_amount <= v_threshold AND v_vendor_id <> v_primary_vendor_id, 1, 0);

        INSERT INTO t_day_bill_header (day_bill_id, bill_type, vendor_id, bill_number,
                                       total_amount, created_by, creation_date, updated_by, updation_date)
        VALUES (v_day_bill_id, 'DIGITAL', v_vendor_id,
                (SELECT bill_number FROM tmp_db_bill_numbers
                  WHERE bill_key = CONCAT('DIGITAL:', v_vendor_id) LIMIT 1),
                0, p_user, NOW(), p_user, NOW());

        SET v_dig_header_id = LAST_INSERT_ID();

        IF v_is_consolidated THEN
            -- ── A. Consolidated: single dominant-product line ────────────────
            INSERT INTO t_day_bill_items (header_id, product_id, quantity, rate,
                                          taxable_amount, cgst_rate, cgst_amount,
                                          sgst_rate, sgst_amount, total_amount)
            SELECT
                v_dig_header_id,
                ca.product_id,
                ROUND(ca.qty, 3)                                                             AS quantity,
                ROUND(p.price, 3)                                                            AS rate,
                ROUND(
                    CASE WHEN (p.cgst_rate + p.sgst_rate) > 0
                         THEN v_digital_amount / (1 + (p.cgst_rate + p.sgst_rate) / 100)
                         ELSE v_digital_amount END, 3)                                       AS taxable_amount,
                p.cgst_rate,
                ROUND(
                    CASE WHEN (p.cgst_rate + p.sgst_rate) > 0
                         THEN (v_digital_amount / (1 + (p.cgst_rate + p.sgst_rate) / 100)) * p.cgst_rate / 100
                         ELSE 0 END, 3)                                                      AS cgst_amount,
                p.sgst_rate,
                ROUND(
                    CASE WHEN (p.cgst_rate + p.sgst_rate) > 0
                         THEN (v_digital_amount / (1 + (p.cgst_rate + p.sgst_rate) / 100)) * p.sgst_rate / 100
                         ELSE 0 END, 3)                                                      AS sgst_amount,
                ROUND(v_digital_amount, 3)                                                   AS total_amount
            FROM tmp_db_cons_assign ca
            JOIN tmp_db_pump p ON ca.product_id = p.product_id
            WHERE ca.vendor_id = v_vendor_id;

        ELSEIF v_vendor_id = v_primary_vendor_id THEN
            -- ── B. Primary: adjusted quantities absorbing consolidated residuals ──
            --    adjusted_qty[P] = primary_proportionate[P]
            --                    + consolidated_proportionate[P]   (what they would have got)
            --                    - consolidated_actual[P]          (what they actually get)
            --    Uses pre-calculated tmp_db_primary_items (avoids MySQL 1137 temp-table reopen error)
            INSERT INTO t_day_bill_items (header_id, product_id, quantity, rate,
                                          taxable_amount, cgst_rate, cgst_amount,
                                          sgst_rate, sgst_amount, total_amount)
            SELECT
                v_dig_header_id,
                pi.product_id,
                ROUND(pi.adjusted_qty, 3),
                ROUND(pi.price, 3),
                ROUND(
                    CASE WHEN (pi.cgst_rate + pi.sgst_rate) > 0
                         THEN pi.adjusted_qty * pi.price / (1 + (pi.cgst_rate + pi.sgst_rate) / 100)
                         ELSE pi.adjusted_qty * pi.price END, 3),
                pi.cgst_rate,
                ROUND(
                    CASE WHEN (pi.cgst_rate + pi.sgst_rate) > 0
                         THEN (pi.adjusted_qty * pi.price / (1 + (pi.cgst_rate + pi.sgst_rate) / 100)) * pi.cgst_rate / 100
                         ELSE 0 END, 3),
                pi.sgst_rate,
                ROUND(
                    CASE WHEN (pi.cgst_rate + pi.sgst_rate) > 0
                         THEN (pi.adjusted_qty * pi.price / (1 + (pi.cgst_rate + pi.sgst_rate) / 100)) * pi.sgst_rate / 100
                         ELSE 0 END, 3),
                ROUND(pi.adjusted_qty * pi.price, 3)
            FROM tmp_db_primary_items pi
            WHERE pi.adjusted_qty > 0;

        ELSE
            -- ── C. Normal above-threshold vendor: unchanged proportionate split ──
            INSERT INTO t_day_bill_items (header_id, product_id, quantity, rate,
                                          taxable_amount, cgst_rate, cgst_amount,
                                          sgst_rate, sgst_amount, total_amount)
            SELECT
                v_dig_header_id,
                di.product_id,
                ROUND(di.digital_qty, 3),
                ROUND(p.price, 3),
                ROUND(
                    CASE WHEN (p.cgst_rate + p.sgst_rate) > 0
                         THEN di.digital_qty * p.price / (1 + (p.cgst_rate + p.sgst_rate) / 100)
                         ELSE di.digital_qty * p.price END, 3),
                p.cgst_rate,
                ROUND(
                    CASE WHEN (p.cgst_rate + p.sgst_rate) > 0
                         THEN (di.digital_qty * p.price / (1 + (p.cgst_rate + p.sgst_rate) / 100)) * p.cgst_rate / 100
                         ELSE 0 END, 3),
                p.sgst_rate,
                ROUND(
                    CASE WHEN (p.cgst_rate + p.sgst_rate) > 0
                         THEN (di.digital_qty * p.price / (1 + (p.cgst_rate + p.sgst_rate) / 100)) * p.sgst_rate / 100
                         ELSE 0 END, 3),
                ROUND(di.digital_qty * p.price, 3)
            FROM tmp_db_dig_items di
            JOIN tmp_db_pump p ON di.product_id = p.product_id
            WHERE di.vendor_id  = v_vendor_id
              AND di.digital_qty > 0;

        END IF;

        UPDATE t_day_bill_header
        SET    total_amount = (SELECT COALESCE(SUM(total_amount), 0)
                               FROM   t_day_bill_items
                               WHERE  header_id = v_dig_header_id)
        WHERE  header_id = v_dig_header_id;

    END LOOP vendor_loop;
    CLOSE cur_vendors;

    -- ── 18. Cleanup temp tables ──────────────────────────────────────────────
    DROP TEMPORARY TABLE IF EXISTS tmp_db_pump;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_oil;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_cashsale;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_intercompany;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_credit;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_digital;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_dig_items;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_bill_numbers;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_cons_dominant;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_cons_assign;
    DROP TEMPORARY TABLE IF EXISTS tmp_db_primary_items;

END generate_day_bill_sp //

DELIMITER ;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT 'generate_day_bill procedure created' AS status;
