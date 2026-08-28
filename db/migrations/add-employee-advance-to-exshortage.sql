-- ============================================================
-- calculate_exshortage: account for Employee Advance/Payment/
-- Recovery entries made from the shift-closing Employee Advance tab
--
-- Same gap the Collections-tab receipts fix
-- (add-cash-receipts-to-exshortage.sql) already closed once for
-- t_receipts: a cash-affecting t_employee_ledger entry made during
-- the shift was invisible to this function, so the physical cash
-- movement it represents showed up as an unexplained shortage or
-- excess instead of being correctly netted out.
--
-- ADVANCE/PAYMENT (debit_amount, cash physically leaves the till,
-- handed to an employee) is cash-out-not-from-sales - same group as
-- expenseamt, added back.
-- ADVANCE_RECOVERY (credit_amount, cash physically comes back in,
-- an employee repaying an advance) is cash-in-not-from-sales - same
-- group as creditreceiptcashamt, subtracted.
--
-- Backward compatible: COALESCE(...,0) means any closing with no
-- Employee Advance tab entries (i.e. every closing today, and every
-- location that hasn't enabled ALLOW_EMPLOYEE_ADVANCE_IN_CLOSING)
-- computes byte-for-byte the same result as before.
--
-- Builds on add-cash-receipts-to-exshortage.sql (must be applied
-- first - this is a full re-declaration of the same function,
-- verified against the live copy via SHOW CREATE FUNCTION on
-- 2026-08-27, with no other changes made). Safe to re-run: uses
-- DROP FUNCTION IF EXISTS.
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
