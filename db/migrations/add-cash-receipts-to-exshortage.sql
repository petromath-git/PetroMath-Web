-- ============================================================
-- calculate_exshortage: account for Cash-type credit receipts
-- entered from the shift-closing Collections tab
--
-- When a cashier collects a Cash-type receipt (a credit customer
-- settling their outstanding balance in cash) and correctly counts
-- it into their end-of-shift denominations, that cash was already
-- flowing into `denomamt` (added) with nothing on the subtracted
-- side to explain it - showing up as unexplained excess. This adds
-- a new term, symmetric to amt/twotoilamt/cashasaleamt/
-- closingcashgiven (all "explained cash" - subtracted), summing
-- Cash-type t_receipts rows for the closing.
--
-- Digital-type receipts are intentionally excluded - same as
-- Digital Sales, they have no live cash-reconciliation impact.
--
-- Backward compatible: COALESCE(...,0) means any closing with no
-- Collections-tab receipts (i.e. every closing today, and every
-- location that hasn't enabled ALLOW_CREDIT_RECEIPTS_IN_CLOSING)
-- computes byte-for-byte the same result as before.
--
-- Full re-declaration, structurally identical to the existing
-- function with one added SELECT INTO block and one added term in
-- the final SET. Safe to re-run: uses DROP FUNCTION IF EXISTS.
-- ============================================================

DELIMITER $$

DROP FUNCTION IF EXISTS CALCULATE_EXSHORTAGE$$

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
    DECLARE ex_short_amt          DECIMAL(10,2);


    SELECT COALESCE(SUM((closing_reading - opening_reading - testing) * price), 0)
    INTO amt
    FROM t_reading
    WHERE closing_id = p_closing_id;


    SELECT COALESCE(SUM(tc.price * tc.qty), 0) INTO creditamt
    FROM t_credits tc
    INNER JOIN m_product mp ON tc.product_id = mp.product_id
    INNER JOIN (
        SELECT DISTINCT mp2.product_code
        FROM t_reading tr
        INNER JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
        WHERE tr.closing_id = p_closing_id
    ) pump_products ON mp.product_name = pump_products.product_code
    WHERE tc.closing_id = p_closing_id
    AND COALESCE(tc.off_meter_sale, 0) = 0;


    SELECT COALESCE(SUM((cs.price - cs.price_discount) * cs.qty), 0) INTO cashasaleamt
    FROM t_cashsales cs
    INNER JOIN m_product mp ON cs.product_id = mp.product_id
    WHERE cs.closing_id = p_closing_id
      AND mp.product_name NOT IN (
          SELECT DISTINCT mp2.product_code
          FROM t_reading tr
          INNER JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
          WHERE tr.closing_id = p_closing_id
      );


    SELECT COALESCE(SUM(cs.price_discount * cs.qty), 0) INTO pumpdiscountamt
    FROM t_cashsales cs
    INNER JOIN m_product mp ON cs.product_id = mp.product_id
    WHERE cs.closing_id = p_closing_id
      AND mp.product_name IN (
          SELECT DISTINCT mp2.product_code
          FROM t_reading tr
          INNER JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
          WHERE tr.closing_id = p_closing_id
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
            JOIN m_product mp2 ON mp.product_code = mp2.product_name
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

    SET ex_short_amt = COALESCE(expenseamt, 0) + COALESCE(denomamt, 0) + COALESCE(creditamt, 0)
                     + COALESCE(digitalsaleamt, 0) + COALESCE(pumpdiscountamt, 0)
                     + COALESCE(intercompanyamt, 0)
                     - COALESCE(amt, 0) - COALESCE(twotoilamt, 0) - COALESCE(cashasaleamt, 0)
                     - COALESCE(closingcashgiven, 0) - COALESCE(creditreceiptcashamt, 0);

    RETURN ex_short_amt;
END$$

DELIMITER ;
