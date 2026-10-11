-- Phase 3: stored routines match a pump/tank to its product by product_id
-- (m_pump.product_id / m_tank.product_id, added by pump-tank-product-id.sql)
-- instead of m_pump.product_code = m_product.product_name.
--
-- Bodies are prod's definitions (2026-10-11) with only these joins changed;
-- NOT IN / IN sub-lists of pump products skip a NULL product_id (NOT IN over
-- a list containing NULL matches nothing). Each routine is recreated with
-- the character set it was originally created with.
--
-- Verified on dev: CALCULATE_EXSHORTAGE + get_closing_collection for 1,453
-- closed shifts, get_all_products_stock_summary for 21 locations, 57 day
-- bills, 28 cashflows and 821 tank-stock rows regenerated - identical to the
-- old routines.
--
-- The 2T LOOSE / 2T POUCH / DSR - OIL checks use m_product.product_type
-- instead of the product name.
--
-- RUN AFTER pump-tank-product-id.sql AND product-type.sql. Re-runnable.

-- ── CALCULATE_EXSHORTAGE ──────────────────────────────────────────────
SET NAMES cp850 COLLATE cp850_general_ci;
DROP FUNCTION IF EXISTS `CALCULATE_EXSHORTAGE`;
DELIMITER $$
CREATE FUNCTION `CALCULATE_EXSHORTAGE`(p_closing_id INT) RETURNS decimal(10,2)
BEGIN
    DECLARE amt                   DECIMAL(10,2);
    DECLARE creditamt             DECIMAL(10,2);
    DECLARE cashasaleamt          DECIMAL(10,2);
    DECLARE pumpdiscountamt       DECIMAL(10,2);
    DECLARE digitalsaleamt        DECIMAL(10,2);
    DECLARE twotoilamt            DECIMAL(10,2);
    DECLARE expenseamt            DECIMAL(10,2);
    DECLARE denomamt              DECIMAL(10,2);
    DECLARE closingcashgiven      DECIMAL(10,2);
    DECLARE intercompanyamt       DECIMAL(10,2);
    DECLARE creditreceiptcashamt  DECIMAL(10,2);
    DECLARE employeeAdvanceCashOut DECIMAL(10,2);
    DECLARE employeeAdvanceCashIn  DECIMAL(10,2);
    DECLARE ex_short_amt          DECIMAL(10,2);


    SELECT COALESCE(SUM((closing_reading - opening_reading - testing) * price), 0)
    INTO amt
    FROM t_reading
    WHERE closing_id = p_closing_id;


    SELECT COALESCE(SUM(tc.price * tc.qty), 0) INTO creditamt
    FROM t_credits tc
    INNER JOIN m_product mp ON tc.product_id = mp.product_id
    INNER JOIN (
        SELECT DISTINCT mp2.product_id
        FROM t_reading tr
        INNER JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
        WHERE mp2.product_id IS NOT NULL AND tr.closing_id = p_closing_id
    ) pump_products ON mp.product_id = pump_products.product_id
    WHERE tc.closing_id = p_closing_id
    AND COALESCE(tc.off_meter_sale, 0) = 0;


    SELECT COALESCE(SUM((cs.price - cs.price_discount) * cs.qty), 0) INTO cashasaleamt
    FROM t_cashsales cs
    INNER JOIN m_product mp ON cs.product_id = mp.product_id
    WHERE cs.closing_id = p_closing_id
      AND mp.product_id NOT IN (
          SELECT DISTINCT mp2.product_id
          FROM t_reading tr
          INNER JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
          WHERE mp2.product_id IS NOT NULL AND tr.closing_id = p_closing_id
      );


    SELECT COALESCE(SUM(cs.price_discount * cs.qty), 0) INTO pumpdiscountamt
    FROM t_cashsales cs
    INNER JOIN m_product mp ON cs.product_id = mp.product_id
    WHERE cs.closing_id = p_closing_id
      AND mp.product_id IN (
          SELECT DISTINCT mp2.product_id
          FROM t_reading tr
          INNER JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
          WHERE mp2.product_id IS NOT NULL AND tr.closing_id = p_closing_id
      );

    SELECT COALESCE(SUM(price * (given_qty - returned_qty)), 0) INTO twotoilamt
    FROM t_2toil WHERE closing_id = p_closing_id;

    SELECT COALESCE(SUM(amount), 0) INTO expenseamt
    FROM t_expense WHERE closing_id = p_closing_id;

    SELECT COALESCE(SUM(IF(denomination = '0', 1, denomination) * denomcount), 0) INTO denomamt
    FROM t_denomination WHERE closing_id = p_closing_id;

    SELECT COALESCE(cash, 0) INTO closingcashgiven
    FROM t_closing WHERE closing_id = p_closing_id;

    SELECT COALESCE(SUM(amount), 0) INTO digitalsaleamt
    FROM t_digital_sales WHERE closing_id = p_closing_id;



    SELECT COALESCE(SUM(
        tci.quantity * (
            SELECT AVG(tr.price)
            FROM t_reading tr
            JOIN m_pump mp ON tr.pump_id = mp.pump_id
            JOIN m_product mp2 ON mp2.product_id = mp.product_id
            WHERE tr.closing_id = p_closing_id
              AND mp2.product_id = tci.product_id
        )
    ), 0) INTO intercompanyamt
    FROM t_closing_intercompany tci
    WHERE tci.closing_id = p_closing_id;

    -- Cash-type Collections-tab receipts: already-collected cash, explained
    -- the same way amt/twotoilamt/cashasaleamt/closingcashgiven are.
    SELECT COALESCE(SUM(amount), 0) INTO creditreceiptcashamt
    FROM t_receipts
    WHERE closing_id = p_closing_id
      AND receipt_type = 'Cash';

    -- Employee Advance tab: ADVANCE/PAYMENT cash paid out to an employee -
    -- same group as expenseamt (cash-out-not-from-sales).
    SELECT COALESCE(SUM(debit_amount), 0) INTO employeeAdvanceCashOut
    FROM t_employee_ledger
    WHERE closing_id = p_closing_id
      AND txn_type IN ('ADVANCE', 'PAYMENT');

    -- Employee Advance tab: ADVANCE_RECOVERY cash paid back in by an employee -
    -- same group as creditreceiptcashamt (cash-in-not-from-sales).
    SELECT COALESCE(SUM(credit_amount), 0) INTO employeeAdvanceCashIn
    FROM t_employee_ledger
    WHERE closing_id = p_closing_id
      AND txn_type = 'ADVANCE_RECOVERY';

    SET ex_short_amt = COALESCE(expenseamt, 0) + COALESCE(denomamt, 0) + COALESCE(creditamt, 0)
                     + COALESCE(digitalsaleamt, 0) + COALESCE(pumpdiscountamt, 0)
                     + COALESCE(intercompanyamt, 0) + COALESCE(employeeAdvanceCashOut, 0)
                     - COALESCE(amt, 0) - COALESCE(twotoilamt, 0) - COALESCE(cashasaleamt, 0)
                     - COALESCE(closingcashgiven, 0) - COALESCE(creditreceiptcashamt, 0)
                     - COALESCE(employeeAdvanceCashIn, 0);

    RETURN ex_short_amt;
END$$
DELIMITER ;

-- ── get_closing_collection ────────────────────────────────────────────
SET NAMES cp850 COLLATE cp850_general_ci;
DROP FUNCTION IF EXISTS `get_closing_collection`;
DELIMITER $$
CREATE FUNCTION `get_closing_collection`(
    p_closing_id INT,
    p_location_code VARCHAR(50)
) RETURNS decimal(20,2)
    READS SQL DATA
    DETERMINISTIC
BEGIN
    DECLARE l_pump_sales DECIMAL(20,2) DEFAULT 0;
    DECLARE l_cash_sales DECIMAL(20,2) DEFAULT 0;
    DECLARE l_oil_loose DECIMAL(20,2) DEFAULT 0;
    DECLARE l_oil_pouch DECIMAL(20,2) DEFAULT 0;
    DECLARE l_credit_sales DECIMAL(20,2) DEFAULT 0;
	DECLARE l_digital_amount DECIMAL(20,2) DEFAULT 0;
    DECLARE l_collection DECIMAL(20,2) DEFAULT 0;

    -- Calculate Pump Sales
    SELECT COALESCE(SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price), 0)
    INTO l_pump_sales
    FROM t_reading tr, m_pump mp, t_closing tc
    WHERE tr.pump_id = mp.pump_id
    AND tr.closing_id = tc.closing_id
    AND tc.closing_id = p_closing_id
    AND tc.location_code = p_location_code
    AND tc.closing_status = 'CLOSED';

    -- Calculate Cash Sales (excluding pump products)
    SELECT COALESCE(SUM(tcs.amount), 0)
    INTO l_cash_sales
    FROM t_cashsales tcs,
         m_product mp,
         t_closing tcl
    WHERE tcs.product_id = mp.product_id
    AND mp.product_id NOT IN (
        SELECT DISTINCT mp2.product_id
        FROM t_reading tr, m_pump mp2
        WHERE mp2.product_id IS NOT NULL AND tr.closing_id = tcl.closing_id
        AND tr.pump_id = mp2.pump_id
    )
    AND tcl.location_code = p_location_code
    AND tcl.closing_id = p_closing_id
    AND tcs.closing_id = tcl.closing_id
    AND tcl.closing_status = 'CLOSED';

    -- Calculate 2T LOOSE: DSR-OIL master price only applies at MC/MUE/MC2/MME,
    -- which is the only concept of that name; every other location prices off
    -- the transaction's own recorded price (net quantity sold)
    SELECT COALESCE(SUM((tt.given_qty - tt.returned_qty) * (
        CASE
            WHEN p_location_code IN ('MC','MUE','MC2','MME')
                THEN (SELECT price FROM m_product
                       WHERE product_type = 'DSR_OIL'
                         AND location_code = p_location_code)
            ELSE tt.price
        END
    )), 0)
    INTO l_oil_loose
    FROM t_2toil tt,
         m_product mp,
         t_closing tc
    WHERE tt.product_id = mp.product_id
    AND mp.product_type = '2T_LOOSE'
    AND tt.closing_id = tc.closing_id
    AND tc.closing_id = p_closing_id
    AND tc.location_code = p_location_code
    AND tc.closing_status = 'CLOSED';

    -- Calculate 2T POUCH with price from t_2toil (historical price)
    SELECT COALESCE(SUM((tt.given_qty - tt.returned_qty) * tt.price), 0)
    INTO l_oil_pouch
    FROM t_2toil tt,
         m_product mp,
         t_closing tc
    WHERE tt.product_id = mp.product_id
    AND mp.product_type = '2T_POUCH'
    AND tt.closing_id = tc.closing_id
    AND tc.closing_id = p_closing_id
    AND tc.location_code = p_location_code
    AND tc.closing_status = 'CLOSED';

    -- Calculate Credit Sales (ONLY for products that have pump readings - SP logic)
    SELECT COALESCE(SUM(tcr.qty * tcr.price), 0)
    INTO l_credit_sales
    FROM t_credits tcr, m_product mp, t_closing tc
    WHERE tcr.product_id = mp.product_id
    AND tcr.closing_id = tc.closing_id
    AND tc.closing_id = p_closing_id
    AND tc.location_code = p_location_code
    AND tc.closing_status = 'CLOSED'
    AND mp.product_id IN (
        SELECT DISTINCT mp2.product_id
        FROM t_reading tr, m_pump mp2
        WHERE mp2.product_id IS NOT NULL AND tr.closing_id = p_closing_id
        AND tr.pump_id = mp2.pump_id
    );


	-- Subtract the Digital sales as well.

	  select COALESCE(sum(tds.amount), 0) into l_digital_amount
 												  from t_digital_sales tds,
 													   t_closing tc
 												  where tds.closing_id = tc.closing_id
 													and  tc.location_code = p_location_code
 													and  tc.closing_id = p_closing_id
 													and tc.closing_status = 'CLOSED';

    -- Final collection: (Pump + Cash + Oil Sales) - Credit Sales (pump products only)
    SET l_collection = (l_pump_sales + l_cash_sales + l_oil_loose + l_oil_pouch) - l_credit_sales - l_digital_amount;

    RETURN l_collection;
END$$
DELIMITER ;

-- ── generate_day_bill ─────────────────────────────────────────────────
SET NAMES cp850 COLLATE cp850_general_ci;
DROP PROCEDURE IF EXISTS `generate_day_bill`;
DELIMITER $$
CREATE PROCEDURE `generate_day_bill`(
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

    -- - Cleanup any leftover temp tables from previous call in this session -
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

    -- - 1. Reading-product pump quantities for the day -
    --    Weighted-average price across all shifts closed on p_bill_date.
    --    Joined via m_pump.product_id (kept in step with product_code by trigger).
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
        CAST(0 AS DECIMAL(12,3)) AS net_qty,
        CAST(0 AS DECIMAL(12,3)) AS split_qty
    FROM t_reading r
    JOIN t_closing c  ON r.closing_id = c.closing_id
    JOIN m_pump mp    ON r.pump_id = mp.pump_id
                     AND DATE(c.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
    JOIN m_product p  ON p.product_id = mp.product_id
                     AND p.location_code  = c.location_code
    WHERE c.location_code = p_location_code
      AND DATE(c.closing_date) = p_bill_date
      AND c.closing_status = 'CLOSED'
    GROUP BY p.product_id, p.product_name, p.hsn_code, p.cgst_percent, p.sgst_percent
    HAVING pumped_qty > 0;

    -- - 2. 2T / loose oil quantities for the day -
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
                     AND p.product_type = '2T_LOOSE'
                THEN (SELECT dsr.price
                      FROM m_product dsr
                      WHERE dsr.product_type = 'DSR_OIL'
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

    -- - 3. Early exit if nothing to bill -
    SELECT COUNT(*) INTO v_pump_count FROM tmp_db_pump;
    SELECT COUNT(*) INTO v_oil_count  FROM tmp_db_oil;

    IF v_pump_count = 0 AND v_oil_count = 0 THEN
        --    No CLOSED shifts left for the day (e.g. the only shift was reopened
        --    or deleted). Empty any existing day bill instead of leaving it stale:
        --    items removed, header totals zeroed (bill numbers kept for re-close),
        --    and the parent row touched so the GL update trigger reverses postings.
        SELECT day_bill_id INTO v_day_bill_id
        FROM   t_day_bill
        WHERE  location_code = p_location_code AND bill_date = p_bill_date;

        IF v_day_bill_id IS NOT NULL THEN
            DELETE it FROM t_day_bill_items it
            JOIN t_day_bill_header h ON h.header_id = it.header_id
            WHERE h.day_bill_id = v_day_bill_id;

            UPDATE t_day_bill_header SET total_amount = 0 WHERE day_bill_id = v_day_bill_id;

            UPDATE t_day_bill
            SET    updated_by = p_user, updation_date = NOW()
            WHERE  day_bill_id = v_day_bill_id;
        END IF;

        DROP TEMPORARY TABLE IF EXISTS tmp_db_pump;
        DROP TEMPORARY TABLE IF EXISTS tmp_db_oil;
        LEAVE generate_day_bill_sp;
    END IF;

    -- - 4. Cash-sale quantities for reading products (already individually billed) -
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

    -- - 4b. Intercompany fill quantities (bowser fills - excluded from billable qty) -
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

    -- - 4c. Credit quantities - exclude off-meter (barrel) sales -
    --    off_meter_sale = 1 means the product was handed over physically without
    --    going through the pump meter, so it must NOT be deducted from pumped_qty.
    --    Built before the digital split (step 6/9) so credits are netted out first.
    CREATE TEMPORARY TABLE tmp_db_credit
    SELECT
        tc.product_id,
        CAST(SUM(tc.qty) AS DECIMAL(12,3)) AS credit_qty
    FROM t_credits tc
    JOIN t_closing c ON tc.closing_id = c.closing_id
    WHERE c.location_code = p_location_code
      AND DATE(c.closing_date) = p_bill_date
      AND c.closing_status = 'CLOSED'
      AND COALESCE(tc.off_meter_sale, 0) = 0
    GROUP BY tc.product_id;

    -- - 5. Compute net_qty = pumped - cashsales - intercompany (floor at 0) -
    --    split_qty = net_qty - credits (floor at 0): the quantity actually left for
    --    cash + digital, used as the basis for the digital split. Splitting on
    --    net_qty instead over-allocated digital to credit-heavy products, whose
    --    cash line then floored at 0 while other products' cash stayed inflated
    --    (day bill + credits exceeded the meter).
    UPDATE tmp_db_pump p
    LEFT  JOIN tmp_db_cashsale cs     ON p.product_id = cs.product_id
    LEFT  JOIN tmp_db_intercompany ic ON p.product_id = ic.product_id
    LEFT  JOIN tmp_db_credit cr       ON p.product_id = cr.product_id
    SET   p.cashsale_qty = COALESCE(cs.cashsale_qty, 0),
          p.net_qty      = GREATEST(0, p.pumped_qty
                                       - COALESCE(cs.cashsale_qty, 0)
                                       - COALESCE(ic.intercompany_qty, 0)),
          p.split_qty    = GREATEST(0, p.pumped_qty
                                       - COALESCE(cs.cashsale_qty, 0)
                                       - COALESCE(ic.intercompany_qty, 0)
                                       - COALESCE(cr.credit_qty, 0));

    -- - 6. Total split revenue (denominator for digital split) -
    SELECT COALESCE(SUM(split_qty * price), 0)
    INTO   v_total_net_revenue
    FROM   tmp_db_pump
    WHERE  price > 0;

    --    Fallback: if credits consumed every product's quantity (data anomaly -
    --    digital recorded on a day with nothing left after credits), split on
    --    net_qty as before rather than dropping the digital amount.
    IF v_total_net_revenue = 0 THEN
        UPDATE tmp_db_pump SET split_qty = net_qty;
        SELECT COALESCE(SUM(split_qty * price), 0)
        INTO   v_total_net_revenue
        FROM   tmp_db_pump
        WHERE  price > 0;
    END IF;

    -- - 7. Digital vendor totals for the day -
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

    -- - 7b. Read consolidation threshold from location config -
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

    -- - 8. (credit quantities moved to step 4c) -

    -- - 9. Proportionate digital items -
    --    digital_qty[V,P] = (split_revenue[P] / total_split_revenue) - (vendor_amt[V] / price[P])
    CREATE TEMPORARY TABLE tmp_db_dig_items
    SELECT
        d.vendor_id,
        p.product_id,
        CAST(
            CASE
                WHEN v_total_net_revenue > 0 AND p.price > 0
                THEN (p.split_qty * p.price / v_total_net_revenue) * (d.digital_amount / p.price)
                ELSE 0
            END
        AS DECIMAL(12,6)) AS digital_qty
    FROM tmp_db_digital  d
    CROSS JOIN tmp_db_pump p;

    -- - 9b. Build consolidated-vendor tables -
    --    For each vendor - threshold (and not the primary), find their dominant
    --    product (highest proportionate value) - they will be billed on that
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
    --   qty = vendor_amount / dominant_price  (so qty - price = vendor_amount exactly)
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

    -- - 10. Upsert t_day_bill parent row -
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

    -- - 11. Preserve existing bill numbers -
    CREATE TEMPORARY TABLE tmp_db_bill_numbers
    SELECT
        CONCAT(bill_type, ':', COALESCE(vendor_id, 'null')) AS bill_key,
        bill_number
    FROM t_day_bill_header
    WHERE day_bill_id = v_day_bill_id AND bill_number IS NOT NULL AND bill_number <> '';

    -- - 12. Wipe old headers (items cascade via FK ON DELETE CASCADE) -
    DELETE FROM t_day_bill_header WHERE day_bill_id = v_day_bill_id;

    -- - 13. Insert CASH header -
    INSERT INTO t_day_bill_header (day_bill_id, bill_type, vendor_id, bill_number,
                                   total_amount, created_by, creation_date, updated_by, updation_date)
    VALUES (v_day_bill_id, 'CASH', NULL,
            (SELECT bill_number FROM tmp_db_bill_numbers WHERE bill_key = 'CASH:null' LIMIT 1),
            0, p_user, NOW(), p_user, NOW());

    SET v_header_id = LAST_INSERT_ID();

    -- - 14. CASH items - reading products -
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

    -- - 15. CASH items - 2T oil (all cash, no digital/credit deduction) -
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

    -- - 16. Update CASH header total -
    UPDATE t_day_bill_header
    SET    total_amount = (SELECT COALESCE(SUM(total_amount), 0)
                           FROM   t_day_bill_items
                           WHERE  header_id = v_header_id)
    WHERE  header_id = v_header_id;

    -- - 17. DIGITAL headers + items (one per vendor) -
    --
    --  Three cases per vendor:
    --    A. Consolidated (- threshold, not primary): single dominant-product line,
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
            -- - A. Consolidated: single dominant-product line -
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
            -- - B. Primary: adjusted quantities absorbing consolidated residuals -
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
            -- - C. Normal above-threshold vendor: unchanged proportionate split -
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

    -- - 18. Cleanup temp tables -
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

END generate_day_bill_sp$$
DELIMITER ;

-- ── generate_cashflow ─────────────────────────────────────────────────
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
DROP PROCEDURE IF EXISTS `generate_cashflow`;
DELIMITER $$
CREATE PROCEDURE `generate_cashflow`(IN p_cashflow_id INT)
BEGIN

    DECLARE creditamount INT DEFAULT 0;
    DECLARE totalamount INT DEFAULT 0;
    DECLARE CashSaleamount INT DEFAULT 0;
    DECLARE l_pump_discount DECIMAL(20,2) DEFAULT 0;
    DECLARE diaryclosecnt INT DEFAULT 0;
    DECLARE l_location_code VARCHAR(50);
    DECLARE d_cashflow_date DATE;
    DECLARE l_closing_id INT;
    DECLARE exit_loop BOOLEAN;
    DECLARE l_tran_type, l_remarks VARCHAR(500);
    DECLARE l_amount DECIMAL(20,2);
    DECLARE l_source_id INT;
	DECLARE l_intercompany_amount DECIMAL(20,2) DEFAULT 0;
    DECLARE l_digital_amount DECIMAL(20,2);
    DECLARE l_oil_amount, l_given_qty, l_cash_bf, l_credits, l_debits DECIMAL(20,2);
    DECLARE l_session_id VARCHAR(50);
    DECLARE l_prev_cashflow_date DATE;
    DECLARE l_cashflow_enabled VARCHAR(100);
    DECLARE l_collection_desc VARCHAR(200);
    DECLARE l_min_date, l_max_date DATE;
    DECLARE l_has_prior_cf INT DEFAULT 0;

    -- First Day Close for the location (l_has_prior_cf = 0): no lookback,
    -- otherwise a pre-go-live shift from the day before gets pulled in.
    DECLARE cur_closing_id CURSOR FOR
        SELECT closing_id
        FROM t_closing
        WHERE location_code = l_location_code
          AND closing_status = 'CLOSED'
          AND (cashflow_id IS NULL OR cashflow_id = p_cashflow_id)
          AND DATE(closing_date) >= CASE WHEN l_has_prior_cf > 0
                                         THEN DATE_SUB(d_cashflow_date, INTERVAL 1 DAY)
                                         ELSE d_cashflow_date END
          AND DATE(closing_date) <= d_cashflow_date;

    DECLARE cur_cash_receipts CURSOR FOR
        SELECT tr.amount,
               CONCAT(COALESCE(mcl.short_name, mcl.company_name), ' - Receipt No: ', tr.receipt_no) AS remarks,
               tr.treceipt_id
        FROM t_receipts tr
        JOIN m_credit_list mcl ON tr.creditlist_id = mcl.creditlist_id
        WHERE tr.receipt_type = 'Cash'
          AND tr.location_code = l_location_code
          AND tr.cashflow_date IS NULL
          AND (
              tr.pending_cashflow_id IS NULL
              OR NOT EXISTS (
                  SELECT 1 FROM t_cashflow_closing tcc
                  WHERE tcc.cashflow_id = tr.pending_cashflow_id
              )
          )
          AND (
              tr.closing_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM t_closing tc3
                  WHERE tc3.closing_id = tr.closing_id
                    AND tc3.closing_status = 'CLOSED'
              )
          )
          AND DATE(tr.receipt_date) <= d_cashflow_date;

    DECLARE cur_cash_expense CURSOR FOR
        SELECT CONCAT(me.expense_name,'  ',te.notes) AS remarks,
               SUM(te.amount) AS amount
        FROM t_expense te
        JOIN m_expense me ON te.expense_id = me.expense_id
        JOIN t_closing tc ON tc.closing_id = te.closing_id
        WHERE tc.location_code = l_location_code
          AND tc.closing_id IN (SELECT closing_id
                                FROM t_cashflow_generation_temp
                                WHERE session_id = l_session_id)
          AND tc.closing_status = 'CLOSED'
        GROUP BY me.expense_name, te.notes;

    DECLARE cur_tt_expense CURSOR FOR
        SELECT CONCAT(tte.truck_number,'---',tte.expense,'---',tte.qty) AS remarks,
               tte.amount
        FROM t_truckexpense_v tte
        WHERE tte.location_code = l_location_code
          AND DATE(tte.expense_date) = d_cashflow_date
          AND tte.payment_name = 'Cash';


    DECLARE cur_salary_payout CURSOR FOR
        SELECT CONCAT(emp.name, ' (', el.txn_type, ')') AS remarks,
               el.debit_amount AS amount,
               el.ledger_id,
               el.txn_type
        FROM t_employee_ledger el
        JOIN m_employee emp ON el.employee_id = emp.employee_id
        WHERE el.location_code = l_location_code
          AND el.cashflow_date IS NULL
          AND (
              el.pending_cashflow_id IS NULL
              OR NOT EXISTS (
                  SELECT 1 FROM t_cashflow_closing tcc
                  WHERE tcc.cashflow_id = el.pending_cashflow_id
              )
          )
          AND (
              el.closing_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM t_closing tc5
                  WHERE tc5.closing_id = el.closing_id
                    AND tc5.closing_status = 'CLOSED'
              )
          )
          AND DATE(el.txn_date) <= d_cashflow_date
          AND el.txn_type IN ('ADVANCE', 'PAYMENT')
          AND el.debit_amount > 0;


    DECLARE cur_salary_recovery CURSOR FOR
        SELECT CONCAT(emp.name, ' - Recovery') AS remarks,
               el.credit_amount AS amount,
               el.ledger_id
        FROM t_employee_ledger el
        JOIN m_employee emp ON el.employee_id = emp.employee_id
        WHERE el.location_code = l_location_code
          AND el.cashflow_date IS NULL
          AND (
              el.pending_cashflow_id IS NULL
              OR NOT EXISTS (
                  SELECT 1 FROM t_cashflow_closing tcc
                  WHERE tcc.cashflow_id = el.pending_cashflow_id
              )
          )
          AND (
              el.closing_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM t_closing tc6
                  WHERE tc6.closing_id = el.closing_id
                    AND tc6.closing_status = 'CLOSED'
              )
          )
          AND DATE(el.txn_date) <= d_cashflow_date
          AND el.txn_type = 'ADVANCE_RECOVERY'
          AND el.credit_amount > 0;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET exit_loop = TRUE;

    -- CASHFLOW_ENABLED gate (before any write). With the flag off,
    -- receipts/advances/tank receipts are stamped with cashflow_date at
    -- save, so a Day Close here would silently miss them. Resolved like
    -- the app: location row first, then '*'. Scalar subqueries, so the
    -- NOT FOUND handler above is not tripped.
    SET l_cashflow_enabled = (
        SELECT LOWER(TRIM(c.setting_value))
        FROM m_location_config c
        JOIN t_cashflow_closing tcc ON tcc.cashflow_id = p_cashflow_id
        WHERE c.setting_name = 'CASHFLOW_ENABLED'
          AND c.location_code IN (tcc.location_code, '*')
          AND CURDATE() BETWEEN c.effective_start_date AND c.effective_end_date
        ORDER BY CASE WHEN c.location_code = tcc.location_code THEN 0 ELSE 1 END,
                 c.effective_start_date DESC
        LIMIT 1);

    IF IFNULL(l_cashflow_enabled, 'false') <> 'true' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cashflow is not enabled for this location (CASHFLOW_ENABLED), so Day Close cannot be generated. Please contact support.';
    END IF;

    SET l_session_id = CONCAT(CONNECTION_ID(), '_', p_cashflow_id, '_', NOW());

    DELETE FROM t_cashflow_generation_temp WHERE session_id = l_session_id;
    DELETE FROM t_debug_msg;
    DELETE FROM t_cashflow_transaction
     WHERE cashflow_id = p_cashflow_id AND calc_flag = 'Y';


    UPDATE t_receipts SET pending_cashflow_id = NULL
    WHERE pending_cashflow_id = p_cashflow_id;
    UPDATE t_employee_ledger SET pending_cashflow_id = NULL
    WHERE pending_cashflow_id = p_cashflow_id;

    SELECT location_code, cashflow_date
    INTO l_location_code, d_cashflow_date
    FROM t_cashflow_closing
    WHERE cashflow_id = p_cashflow_id;

    -- Same "previous Day Close" test as the Balance B/F lookup below.
    -- Scalar subquery, so the NOT FOUND handler is not tripped.
    SET l_has_prior_cf = (
        SELECT COUNT(*)
        FROM t_cashflow_closing tcc
        WHERE tcc.location_code = l_location_code
          AND tcc.cashflow_date < d_cashflow_date
          AND tcc.cashflow_id != p_cashflow_id);

    SET exit_loop = FALSE;
    OPEN cur_closing_id;
    build_closing_list: LOOP
        FETCH cur_closing_id INTO l_closing_id;
        IF exit_loop THEN
            CLOSE cur_closing_id;
            LEAVE build_closing_list;
        END IF;
        INSERT INTO t_cashflow_generation_temp (session_id, closing_id)
        VALUES (l_session_id, l_closing_id);
    END LOOP build_closing_list;

    SELECT prev_date,
           COALESCE(credits, 0) - COALESCE(debits, 0) AS balance_bf
    INTO l_prev_cashflow_date, l_cash_bf
    FROM (
        SELECT MAX(tcc.cashflow_date) AS prev_date,
               (SELECT COALESCE(SUM(tct.amount), 0)
                FROM t_cashflow_transaction tct
                JOIN t_cashflow_closing tcc2 ON tct.cashflow_id = tcc2.cashflow_id
                                           AND tcc2.location_code = l_location_code
                WHERE tcc2.cashflow_date = MAX(tcc.cashflow_date)
                  AND tct.entry_type = 'CREDIT'
               ) AS credits,
               (SELECT COALESCE(SUM(tct.amount), 0)
                FROM t_cashflow_transaction tct
                JOIN t_cashflow_closing tcc2 ON tct.cashflow_id = tcc2.cashflow_id
                                           AND tcc2.location_code = l_location_code
                WHERE tcc2.cashflow_date = MAX(tcc.cashflow_date)
                  AND tct.entry_type = 'DEBIT'
               ) AS debits
        FROM t_cashflow_closing tcc
        WHERE tcc.location_code = l_location_code
          AND tcc.cashflow_date < d_cashflow_date
          AND tcc.cashflow_id != p_cashflow_id
    ) prev_data;

    IF l_prev_cashflow_date IS NOT NULL THEN
        SET l_remarks = CONCAT('From Day Close Dated:  ', DATE_FORMAT(l_prev_cashflow_date, '%d/%m/%Y'));
    ELSE
        SET l_remarks = 'Opening Balance - No previous cashflow';
        SET l_cash_bf = 0;
    END IF;

    INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
    VALUES(p_cashflow_id, l_remarks, 'Balance B/F', l_cash_bf, 'Y');

    IF(l_location_code <> 'MCA') THEN

        SELECT SUM(totalsalamt) - SUM(COALESCE(crsaleamtwithoutdisc,0))
        INTO l_amount
        FROM (
            SELECT product_id,
                   SUM(ROUND(total_amt,2)) AS totalsalamt,
                   (SELECT SUM(ROUND(tcr.qty * tcr.price,2))
                    FROM t_credits tcr
                    JOIN m_product mp ON tcr.product_id = mp.product_id
                    JOIN t_closing tc ON tcr.closing_id = tc.closing_id
                    WHERE tc.location_code = l_location_code
                      AND tc.closing_id IN (SELECT closing_id
                                            FROM t_cashflow_generation_temp
                                            WHERE session_id = l_session_id)
                      AND tc.closing_status = 'CLOSED'
                      AND mp.product_id = a.product_id
                      AND COALESCE(tcr.off_meter_sale, 0) = 0
                    GROUP BY mp.product_name) AS crsaleamtwithoutdisc
            FROM (
                SELECT mp.pump_code,
                       mp.product_id,
                       SUM((tr.closing_reading - tr.opening_reading - tr.testing) * price) AS total_amt
                FROM t_reading tr
                JOIN m_pump mp ON tr.pump_id = mp.pump_id
                JOIN t_closing tc ON tr.closing_id = tc.closing_id
                WHERE tc.location_code = l_location_code
                  AND tc.closing_id IN (SELECT closing_id
                                        FROM t_cashflow_generation_temp
                                        WHERE session_id = l_session_id)
                  AND tc.closing_status = 'CLOSED'
                GROUP BY mp.pump_code, mp.product_id
            ) a
            GROUP BY product_id
        ) c;

        SELECT ROUND(SUM(a.cash_amt),2) INTO l_oil_amount
        FROM (
            SELECT (given_qty - returned_qty) *
                   CASE
                     WHEN l_location_code IN ('MC','MUE','MC2','MME')
                       THEN (SELECT price FROM m_product
                              WHERE product_type = 'DSR_OIL'
                                AND location_code = l_location_code)
                     ELSE tc.price
                   END AS cash_amt
            FROM t_2toil tc
            JOIN m_product mp ON tc.product_id = mp.product_id
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            WHERE mp.product_type = '2T_LOOSE'
              AND tcl.location_code = l_location_code
              AND tcl.closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id)
              AND tcl.closing_status = 'CLOSED'

            UNION ALL
            SELECT (given_qty - returned_qty) * mp.price
            FROM t_2toil tc
            JOIN m_product mp ON tc.product_id = mp.product_id
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            WHERE mp.product_type = '2T_POUCH'
              AND tcl.location_code = l_location_code
              AND tcl.closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id)
              AND tcl.closing_status = 'CLOSED'

            UNION ALL
            SELECT tc.amount
            FROM t_cashsales tc
            JOIN m_product mp ON tc.product_id = mp.product_id
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            WHERE mp.product_id NOT IN (
                      SELECT DISTINCT mp2.product_id
                      FROM t_reading tr
                      JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
                      WHERE mp2.product_id IS NOT NULL AND tr.closing_id = tcl.closing_id
                  )
              AND tcl.location_code = l_location_code
              AND tcl.closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id)
              AND tcl.closing_status = 'CLOSED'
        ) a;

        SELECT COALESCE(SUM(tds.amount), 0)
        INTO l_digital_amount
        FROM t_digital_sales tds
        JOIN t_closing tc ON tds.closing_id = tc.closing_id
        WHERE tc.location_code = l_location_code
          AND tc.closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id)
          AND tc.closing_status = 'CLOSED';




        SELECT COALESCE(SUM(
            tci.quantity * (
                SELECT AVG(tr.price)
                FROM t_reading tr
                JOIN m_pump mp ON tr.pump_id = mp.pump_id
                JOIN m_product mp2 ON mp2.product_id = mp.product_id
                WHERE tr.closing_id = tci.closing_id
                  AND mp2.product_id = tci.product_id
            )
        ), 0)
        INTO l_intercompany_amount
        FROM t_closing_intercompany tci
        JOIN t_closing tc ON tci.closing_id = tc.closing_id
        WHERE tc.location_code = l_location_code
          AND tc.closing_id IN (SELECT closing_id
                                FROM t_cashflow_generation_temp
                                WHERE session_id = l_session_id)
          AND tc.closing_status = 'CLOSED';

        SET l_amount = COALESCE(l_amount,0) + COALESCE(l_oil_amount,0) - COALESCE(l_digital_amount,0) - COALESCE(l_intercompany_amount,0);

        SELECT MIN(DATE(tc.closing_date)), MAX(DATE(tc.closing_date))
        INTO l_min_date, l_max_date
        FROM t_closing tc
        WHERE tc.closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id);

        IF l_min_date = l_max_date THEN
            SET l_collection_desc = CONCAT('From Closing: ', DATE_FORMAT(l_min_date, '%d/%m/%Y'));
        ELSE
            SET l_collection_desc = CONCAT('From Closings: ', DATE_FORMAT(l_min_date, '%d/%m/%Y'),
                                           ' to ', DATE_FORMAT(l_max_date, '%d/%m/%Y'));
        END IF;

        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_collection_desc, 'Collection', l_amount, 'Y');

        INSERT INTO t_debug_msg(creation_date, module, msg)
        VALUES(NOW(),'Generate Cashflow collection', l_amount);

        IF l_location_code IN ('MC2','MME','MC','MUE') THEN
            SELECT SUM(tt.given_qty - tt.returned_qty),
                   SUM(tt.given_qty - tt.returned_qty) *
                       (MAX(mp.price) - (SELECT mp2.price FROM m_product mp2
                                          WHERE mp2.product_type = 'DSR_OIL'
                                            AND mp2.location_code = l_location_code))
            INTO l_remarks, l_oil_amount
            FROM t_2toil tt
            JOIN t_closing tc ON tc.closing_id = tt.closing_id
            JOIN m_product mp ON tt.product_id = mp.product_id
            WHERE tc.location_code = l_location_code
              AND tc.closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id)
              AND tc.closing_status = 'CLOSED'
              AND mp.product_type = '2T_LOOSE';

            INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
            VALUES(p_cashflow_id, l_remarks, '2T Oil', l_oil_amount, 'Y');
        END IF;

        SELECT COALESCE(SUM(cs.price_discount * cs.qty), 0)
        INTO l_pump_discount
        FROM t_cashsales cs
        INNER JOIN m_product mp ON cs.product_id = mp.product_id
        INNER JOIN t_closing tc ON cs.closing_id = tc.closing_id
        WHERE tc.location_code = l_location_code
          AND tc.closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id)
          AND tc.closing_status = 'CLOSED'
          AND mp.product_id IN (
              SELECT DISTINCT mp2.product_id FROM m_pump mp2 WHERE mp2.product_id IS NOT NULL AND mp2.location_code = l_location_code
          );

        IF l_pump_discount > 0 THEN
            INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
            VALUES(p_cashflow_id, 'Pump Product Discounts', 'Discount', l_pump_discount, 'Y');
        END IF;

        SET exit_loop = FALSE;
        OPEN cur_closing_id;
        daily_closing_loop: LOOP
            FETCH cur_closing_id INTO l_closing_id;
            IF exit_loop THEN
                CLOSE cur_closing_id;
                LEAVE daily_closing_loop;
            END IF;
            SELECT CASE WHEN ex_short > 0 THEN 'Cashier A/C (+)' ELSE 'Cashier A/C (-)' END,
                   ex_short, person_name
            INTO l_tran_type, l_amount, l_remarks
            FROM t_indiv_closing_sales_v
            WHERE closing_id = l_closing_id;
            IF(l_amount < 0) THEN SET l_amount = l_amount * -1; END IF;
            INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
            VALUES(p_cashflow_id, l_remarks, l_tran_type, l_amount, 'Y');
        END LOOP daily_closing_loop;

    END IF;


    SET exit_loop = FALSE;
    OPEN cur_cash_receipts;
    cash_receipts_loop: LOOP
        FETCH cur_cash_receipts INTO l_amount, l_remarks, l_source_id;
        IF exit_loop THEN CLOSE cur_cash_receipts; LEAVE cash_receipts_loop; END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag, source_table, source_id)
        VALUES(p_cashflow_id, l_remarks, 'Cash Receipt', l_amount, 'Y', 't_receipts', l_source_id);
    END LOOP cash_receipts_loop;

    UPDATE t_receipts
    SET pending_cashflow_id = p_cashflow_id
    WHERE receipt_type = 'Cash'
      AND location_code = l_location_code
      AND cashflow_date IS NULL
      AND (pending_cashflow_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM t_cashflow_closing tcc WHERE tcc.cashflow_id = pending_cashflow_id))
      AND (closing_id IS NULL OR EXISTS (
              SELECT 1 FROM t_closing tc4
              WHERE tc4.closing_id = t_receipts.closing_id
                AND tc4.closing_status = 'CLOSED'))
      AND DATE(receipt_date) <= d_cashflow_date;


    SET exit_loop = FALSE;
    OPEN cur_cash_expense;
    expense_loop: LOOP
        FETCH cur_cash_expense INTO l_remarks, l_amount;
        IF exit_loop THEN CLOSE cur_cash_expense; LEAVE expense_loop; END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_remarks, 'Expense', l_amount, 'Y');
    END LOOP expense_loop;

    INSERT INTO t_debug_msg(creation_date, module, msg)
    VALUES(NOW(),'Generate Cashflow','Before tt expense');


    SET exit_loop = FALSE;
    OPEN cur_tt_expense;
    tt_expense_loop: LOOP
        FETCH cur_tt_expense INTO l_remarks, l_amount;
        IF exit_loop THEN CLOSE cur_tt_expense; LEAVE tt_expense_loop; END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_remarks, 'Expense', l_amount, 'Y');
    END LOOP tt_expense_loop;

    INSERT INTO t_debug_msg(creation_date, module, msg)
    VALUES(NOW(),'Generate Cashflow','After tt expense');


    SET exit_loop = FALSE;
    OPEN cur_salary_payout;
    salary_payout_loop: LOOP
        FETCH cur_salary_payout INTO l_remarks, l_amount, l_source_id, l_tran_type;
        IF exit_loop THEN CLOSE cur_salary_payout; LEAVE salary_payout_loop; END IF;
        -- ADVANCE is a balance-sheet item, PAYMENT (cash salary) is P&L: separate lines
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag, source_table, source_id)
        VALUES(p_cashflow_id, l_remarks,
               CASE WHEN l_tran_type = 'ADVANCE' THEN 'Salary Advance' ELSE 'Salary Payout' END,
               l_amount, 'Y', 't_employee_ledger', l_source_id);
    END LOOP salary_payout_loop;


    SET exit_loop = FALSE;
    OPEN cur_salary_recovery;
    salary_recovery_loop: LOOP
        FETCH cur_salary_recovery INTO l_remarks, l_amount, l_source_id;
        IF exit_loop THEN CLOSE cur_salary_recovery; LEAVE salary_recovery_loop; END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag, source_table, source_id)
        VALUES(p_cashflow_id, l_remarks, 'Salary Advance Recovery', l_amount, 'Y', 't_employee_ledger', l_source_id);
    END LOOP salary_recovery_loop;


    UPDATE t_employee_ledger
    SET pending_cashflow_id = p_cashflow_id
    WHERE location_code = l_location_code
      AND cashflow_date IS NULL
      AND (pending_cashflow_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM t_cashflow_closing tcc WHERE tcc.cashflow_id = pending_cashflow_id))
      AND txn_type IN ('ADVANCE', 'PAYMENT', 'ADVANCE_RECOVERY')
      AND (closing_id IS NULL OR EXISTS (
              SELECT 1 FROM t_closing tc7
              WHERE tc7.closing_id = t_employee_ledger.closing_id
                AND tc7.closing_status = 'CLOSED'))
      AND DATE(txn_date) <= d_cashflow_date;

    UPDATE t_closing
    SET cashflow_id = p_cashflow_id
    WHERE closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id)
      AND cashflow_id IS NULL;

    DELETE FROM t_cashflow_generation_temp WHERE session_id = l_session_id;

    INSERT INTO t_debug_msg(creation_date, module, msg)
    VALUES(NOW(),'Generate Cashflow','Generate Cashflow END');

END$$
DELIMITER ;

-- ── generate_closing_stock ────────────────────────────────────────────
SET NAMES utf8mb4 COLLATE utf8mb4_general_ci;
DROP PROCEDURE IF EXISTS `generate_closing_stock`;
DELIMITER $$
CREATE PROCEDURE `generate_closing_stock`(IN p_location_code VARCHAR(20),IN p_from_date DATE,IN p_to_date DATE)
BEGIN
  DECLARE l_product_code VARCHAR(10);	
	DECLARE l_nozzle_sales DECIMAL(20,2) default 0;
	DECLARE l_tank_id,l_row_exists INT DEFAULT 0;
	DECLARE l_closing_stock,l_opening_stock,l_offtake_quantity,l_testing DECIMAL(20,2) default 0;
     DECLARE exit_loop,exit_inner_loop BOOLEAN;
     DECLARE l_date DATE;
	
	  
	declare cur_tank cursor for  
	 select tank_id,md.selected_date 
     from m_tank mt,
       ( select selected_date from 
		 (select adddate('1970-01-01',t4*10000 + t3*1000 + t2*100 + t1*10 + t0) selected_date from
		 (select 0 t0 union select 1 union select 2 union select 3 union select 4 union select 5 union select 6 union select 7 union select 8 union select 9) t0,
		 (select 0 t1 union select 1 union select 2 union select 3 union select 4 union select 5 union select 6 union select 7 union select 8 union select 9) t1,
		 (select 0 t2 union select 1 union select 2 union select 3 union select 4 union select 5 union select 6 union select 7 union select 8 union select 9) t2,
		 (select 0 t3 union select 1 union select 2 union select 3 union select 4 union select 5 union select 6 union select 7 union select 8 union select 9) t3,
		 (select 0 t4 union select 1 union select 2 union select 3 union select 4 union select 5 union select 6 union select 7 union select 8 union select 9) t4) v
		where selected_date between p_from_date and p_to_date) md
     where mt.location_code = p_location_code
       and md.selected_date >= mt.effective_start_date     
       and md.selected_date <= mt.effective_end_date;
        

     DECLARE CONTINUE HANDLER FOR NOT FOUND SET exit_loop = TRUE;

 open cur_tank;
  
  tank_product_loop: LOOP
  
    set exit_loop = false;   -- add this
  
  fetch cur_tank into l_tank_id,l_date;
  
  
  
  
   IF exit_loop THEN 
     close cur_tank;
     LEAVE tank_product_loop;
   END IF; 
   
    
     SET l_nozzle_sales = 0;
     SET l_opening_stock = 0;
     SET l_offtake_quantity = 0;
     SET l_closing_stock = 0;
     SET l_testing = 0;
     
     select round(sum(a.sales)),sum(a.test)  into l_nozzle_sales,l_testing
 	  from (
        select mpp.product_id,mpp.pump_id,max(tr.closing_reading)-min(tr.opening_reading) sales,sum(tr.testing) test
                                        from  t_reading tr,m_pump mpp,t_closing tc
                                        where tr.closing_id = tc.closing_id
                                        and   tr.pump_id = mpp.pump_id                                          									
                                        and   DATE(tc.closing_date) = l_date  
                                        and   tc.location_code = p_location_code										
                                        group by  mpp.product_id,mpp.pump_id) a,m_pump_tank mpt 
										where a.pump_id = mpt.pump_id 
										and   mpt.tank_id = l_tank_id
										group by mpt.tank_id,a.product_id;
         								
	 SELECT coalesce(closing_stk_volume,0) INTO l_opening_stock
	 FROM t_tank_stock tts WHERE tank_id = l_tank_id AND closing_stk_date = DATE_SUB(l_date, INTERVAL 1 DAY);
   
   
     select coalesce(sum(ttd.quantity*1000),0)
	 into l_offtake_quantity 
	 from t_tank_stk_rcpt_dtl ttd,t_tank_stk_rcpt ttsr 
	 where ttd.tank_id = l_tank_id 
	   and ttsr.ttank_id = ttd.ttank_id
	   and ttsr.decant_date = l_date;
	   
	SET l_closing_stock = l_opening_stock+l_offtake_quantity+l_testing-coalesce(l_nozzle_sales,0);
	
   
    
    select count(1) INTO l_row_exists from t_tank_stock where tank_id = l_tank_id AND closing_stk_date = l_date;
    
    IF l_row_exists > 0 THEN  
    
    DELETE FROM t_tank_stock where tank_id = l_tank_id AND closing_stk_date = l_date;
    
    END IF;
	   
     INSERT INTO t_tank_stock(closing_stk_date,opening_stk_volume,receipt_stock,testing,nozzle_sales,closing_stk_volume,tank_id,created_by,updated_by,creation_date,updation_date)
      values(l_date,l_opening_stock,l_offtake_quantity,l_testing,l_nozzle_sales,l_closing_stock,l_tank_id,'admin','admin',now(),now());   

 
 END LOOP tank_product_loop;






END$$
DELIMITER ;

-- ── get_all_products_stock_summary ────────────────────────────────────
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
DROP PROCEDURE IF EXISTS `get_all_products_stock_summary`;
DELIMITER $$
CREATE PROCEDURE `get_all_products_stock_summary`(
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

        -- - Opening balance -
        COALESCE(
            get_closing_product_stock_balance(p.product_id, p_location_code, l_opening_date),
            (SELECT SUM(qty)
             FROM t_lubes_stock_adjustment
             WHERE product_id    = p.product_id
               AND location_code = p_location_code
               AND adjustment_type = 'OPENING'
               AND DATE(adjustment_date) = p_from_date)
        ) AS opening_balance,

        -- - Closing balance -
        get_closing_product_stock_balance(p.product_id, p_location_code, p_to_date) AS closing_balance,

        -- - Opening price -
        --    Falls back to selling price when no purchase invoice has ever existed.
        COALESCE(
            CASE WHEN p.is_lube_product = 0 AND p.is_tank_product = 1 THEN
                (SELECT r.price
                 FROM t_reading r
                 JOIN t_closing c  ON r.closing_id = c.closing_id
                 JOIN m_pump mp    ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                 WHERE mp.product_id = p.product_id
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
        , p.price) AS opening_price,

        -- - Closing price -
        --    Falls back to selling price when no purchase invoice has ever existed.
        COALESCE(
            CASE WHEN p.is_lube_product = 0 AND p.is_tank_product = 1 THEN
                (SELECT r.price
                 FROM t_reading r
                 JOIN t_closing c  ON r.closing_id = c.closing_id
                 JOIN m_pump mp    ON r.pump_id = mp.pump_id AND mp.location_code = p_location_code
                 WHERE mp.product_id = p.product_id
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
        , p.price) AS closing_price,

        -- - Total IN (qty) -
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

        -- - Purchase value -
        --    Invoiced quantities are valued at their real rate. Adjustment-IN
        --    quantities (stock added with no invoice) are valued at a fallback
        --    rate: most recent purchase invoice rate at/before p_to_date, else
        --    the product's selling price (m_product.price).
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
                WHERE t.product_id = p.product_id
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

                UNION ALL

                -- Adjustment IN, no invoice of its own - fallback rate
                SELECT sa.qty * COALESCE(
                    CASE WHEN p.is_lube_product = 0 AND p.is_tank_product = 1 THEN
                        (SELECT tid2.rate_per_kl
                         FROM t_tank_invoice_dtl tid2
                         JOIN t_tank_invoice ti2 ON tid2.invoice_id = ti2.id
                         WHERE tid2.product_id   = p.product_id
                           AND ti2.location_id   = p_location_code
                           AND DATE(ti2.invoice_date) <= p_to_date
                         ORDER BY ti2.invoice_date DESC
                         LIMIT 1)
                    ELSE
                        (SELECT li2.net_rate
                         FROM t_lubes_inv_lines li2
                         JOIN t_lubes_inv_hdr hdr2 ON li2.lubes_hdr_id = hdr2.lubes_hdr_id
                         WHERE li2.product_id    = p.product_id
                           AND hdr2.location_code = p_location_code
                           AND DATE(hdr2.invoice_date) <= p_to_date
                         ORDER BY hdr2.invoice_date DESC
                         LIMIT 1)
                    END
                , p.price) AS amt
                FROM t_lubes_stock_adjustment sa
                WHERE sa.product_id      = p.product_id
                  AND sa.location_code   = p_location_code
                  AND sa.adjustment_type = 'IN'
                  AND DATE(sa.adjustment_date) BETWEEN p_from_date AND p_to_date

            ) AS purch_amts
        ), 0) AS purchase_value,

        -- - Total OUT (qty) -
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

        -- - Sales value -
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

END$$
DELIMITER ;

SET NAMES utf8mb4;

-- Verify: none of these routines still joins on product_code
SELECT ROUTINE_NAME, ROUTINE_DEFINITION REGEXP '[a-z0-9_][.]product_code' AS still_joins_on_product_code
FROM   information_schema.ROUTINES
WHERE  ROUTINE_SCHEMA = DATABASE()
  AND  ROUTINE_NAME IN ('CALCULATE_EXSHORTAGE','get_closing_collection','generate_day_bill','generate_cashflow','generate_closing_stock','get_all_products_stock_summary');
