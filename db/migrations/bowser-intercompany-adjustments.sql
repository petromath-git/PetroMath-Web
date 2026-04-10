-- ============================================================
-- Bowser Intercompany Adjustments
-- Updates CALCULATE_EXSHORTAGE and generate_cashflow to
-- account for bowser fill quantities (t_closing_intercompany).
--
-- The intercompany fill goes through the SFS nozzle, so it
-- appears in t_reading (adds to revenue). But the SFS cashier
-- does NOT collect cash for it — it is an intercompany transfer.
-- These adjustments prevent the bowser fill from creating a
-- false shortage in ex/shortage and from inflating the
-- cashflow collection amount.
--
-- Safe to re-run: uses DROP FUNCTION/PROCEDURE IF EXISTS.
-- ============================================================


-- ── 1. CALCULATE_EXSHORTAGE ───────────────────────────────────────────────────

DROP FUNCTION IF EXISTS `CALCULATE_EXSHORTAGE`;

DELIMITER ;;

CREATE DEFINER=`petromath_prod`@`%` FUNCTION `CALCULATE_EXSHORTAGE`(p_closing_id INT) RETURNS decimal(10,2)
BEGIN
    DECLARE amt              DECIMAL(10,2);
    DECLARE creditamt        DECIMAL(10,2);
    DECLARE cashasaleamt     DECIMAL(10,2);
    DECLARE pumpdiscountamt  DECIMAL(10,2);
    DECLARE digitalsaleamt   DECIMAL(10,2);
    DECLARE twotoilamt       DECIMAL(10,2);
    DECLARE expenseamt       DECIMAL(10,2);
    DECLARE denomamt         DECIMAL(10,2);
    DECLARE closingcashgiven DECIMAL(10,2);
    DECLARE intercompanyamt  DECIMAL(10,2);
    DECLARE ex_short_amt     DECIMAL(10,2);

    -- Reading amount
    SELECT COALESCE(SUM((closing_reading - opening_reading - testing) * price), 0)
    INTO amt
    FROM t_reading
    WHERE closing_id = p_closing_id;

    -- Credit amount for pump products in this closing
    SELECT COALESCE(SUM(tc.price * tc.qty), 0) INTO creditamt
    FROM t_credits tc
    INNER JOIN m_product mp ON tc.product_id = mp.product_id
    INNER JOIN (
        SELECT DISTINCT mp2.product_code
        FROM t_reading tr
        INNER JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
        WHERE tr.closing_id = p_closing_id
    ) pump_products ON mp.product_name = pump_products.product_code
    WHERE tc.closing_id = p_closing_id;

    -- Cash sales for NON-PUMP products in this closing
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

    -- Discount amount for PUMP products in this closing
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

    -- Intercompany (bowser fill) amount for this closing
    -- Valued at the weighted-average nozzle price for each product
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

    SET ex_short_amt = COALESCE(expenseamt, 0) + COALESCE(denomamt, 0) + COALESCE(creditamt, 0)
                     + COALESCE(digitalsaleamt, 0) + COALESCE(pumpdiscountamt, 0)
                     + COALESCE(intercompanyamt, 0)         -- bowser fill is "accounted for" like credit
                     - COALESCE(amt, 0) - COALESCE(twotoilamt, 0) - COALESCE(cashasaleamt, 0)
                     - COALESCE(closingcashgiven, 0);

    RETURN ex_short_amt;
END ;;

DELIMITER ;


-- ── 2. generate_cashflow ──────────────────────────────────────────────────────
--
-- Only the Collection calculation block is changed:
-- subtract intercompany fill value from the collection amount so the
-- bowser-nozzle throughput does not inflate the SFS cashflow collection.
--
-- Full procedure redefine (same pattern as the dump).
-- NOTE: This intentionally redefines the full procedure so the file is
-- self-contained and safe to re-run.

DROP PROCEDURE IF EXISTS `generate_cashflow`;

DELIMITER ;;

CREATE DEFINER=`petromath_prod`@`%` PROCEDURE `generate_cashflow`(IN p_cashflow_id INT)
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
    DECLARE l_digital_amount DECIMAL(20,2);
    DECLARE l_intercompany_amount DECIMAL(20,2) DEFAULT 0;
    DECLARE l_oil_amount, l_given_qty, l_cash_bf, l_credits, l_debits DECIMAL(20,2);
    DECLARE l_session_id VARCHAR(50);
    DECLARE l_prev_cashflow_date DATE;
    DECLARE l_collection_desc VARCHAR(200);
    DECLARE l_min_date, l_max_date DATE;

    -- Cursors
    DECLARE cur_closing_id CURSOR FOR
        SELECT closing_id
        FROM t_closing
        WHERE location_code = l_location_code
          AND closing_status = 'CLOSED'
          AND (cashflow_id IS NULL OR cashflow_id = p_cashflow_id)
          AND DATE(closing_date) >= DATE_SUB(d_cashflow_date, INTERVAL 1 DAY)
          AND DATE(closing_date) <= d_cashflow_date;

    DECLARE cur_cash_receipts CURSOR FOR
        SELECT tr.amount,
               CONCAT(COALESCE(mcl.short_name, mcl.company_name), ' - Receipt No: ', tr.receipt_no) AS remarks
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
        SELECT CONCAT(emp.name, ' (', ep.txn_type, ')') AS remarks,
               ep.amount
        FROM t_employee_payable ep
        JOIN m_employee emp ON ep.employee_id = emp.employee_id
        WHERE ep.location_code = l_location_code
          AND ep.cashflow_date IS NULL
          AND (
              ep.pending_cashflow_id IS NULL
              OR NOT EXISTS (
                  SELECT 1 FROM t_cashflow_closing tcc
                  WHERE tcc.cashflow_id = ep.pending_cashflow_id
              )
          )
          AND DATE(ep.txn_date) <= d_cashflow_date
          AND ep.txn_type       IN ('ADVANCE', 'PAYMENT')
          AND ep.deleted_flag   = 'N';

    DECLARE cur_salary_recovery CURSOR FOR
        SELECT CONCAT(emp.name, ' - Recovery') AS remarks,
               ep.amount
        FROM t_employee_payable ep
        JOIN m_employee emp ON ep.employee_id = emp.employee_id
        WHERE ep.location_code = l_location_code
          AND ep.cashflow_date IS NULL
          AND (
              ep.pending_cashflow_id IS NULL
              OR NOT EXISTS (
                  SELECT 1 FROM t_cashflow_closing tcc
                  WHERE tcc.cashflow_id = ep.pending_cashflow_id
              )
          )
          AND DATE(ep.txn_date) <= d_cashflow_date
          AND ep.txn_type       = 'ADVANCE_RECOVERY'
          AND ep.deleted_flag   = 'N';

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET exit_loop = TRUE;

    SET l_session_id = CONCAT(CONNECTION_ID(), '_', p_cashflow_id, '_', NOW());

    DELETE FROM t_cashflow_generation_temp WHERE session_id = l_session_id;
    DELETE FROM t_debug_msg;
    DELETE FROM t_cashflow_transaction
     WHERE cashflow_id = p_cashflow_id AND calc_flag = 'Y';
    UPDATE t_receipts SET pending_cashflow_id = NULL
    WHERE pending_cashflow_id = p_cashflow_id;
    UPDATE t_employee_payable SET pending_cashflow_id = NULL
    WHERE pending_cashflow_id = p_cashflow_id;

    SELECT location_code, cashflow_date
    INTO l_location_code, d_cashflow_date
    FROM t_cashflow_closing
    WHERE cashflow_id = p_cashflow_id;

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

    -- Previous cashflow balance
    SELECT prev_date,
           COALESCE(credits, 0) - COALESCE(debits, 0) AS balance_bf
    INTO l_prev_cashflow_date, l_cash_bf
    FROM (
        SELECT MAX(tcc.cashflow_date) AS prev_date,
               (SELECT COALESCE(SUM(tct.amount), 0)
                FROM t_cashflow_transaction tct
                JOIN m_lookup ml ON ml.lookup_type = 'CashFlow'
                                AND ml.description = tct.type
                                AND ml.tag = 'IN'
                                AND ml.location_code = l_location_code
                JOIN t_cashflow_closing tcc2 ON tct.cashflow_id = tcc2.cashflow_id
                                           AND tcc2.location_code = l_location_code
                WHERE tcc2.cashflow_date = MAX(tcc.cashflow_date)
               ) AS credits,
               (SELECT COALESCE(SUM(tct.amount), 0)
                FROM t_cashflow_transaction tct
                JOIN m_lookup ml ON ml.lookup_type = 'CashFlow'
                                AND ml.description = tct.type
                                AND ml.tag = 'OUT'
                                AND ml.location_code = l_location_code
                JOIN t_cashflow_closing tcc2 ON tct.cashflow_id = tcc2.cashflow_id
                                           AND tcc2.location_code = l_location_code
                WHERE tcc2.cashflow_date = MAX(tcc.cashflow_date)
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

        -- Collection: total nozzle sale minus credit
        SELECT SUM(totalsalamt) - SUM(COALESCE(crsaleamtwithoutdisc,0))
        INTO l_amount
        FROM (
            SELECT product_code,
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
                      AND mp.product_name = a.product_code
                    GROUP BY mp.product_name) AS crsaleamtwithoutdisc
            FROM (
                SELECT mp.pump_code,
                       mp.product_code,
                       SUM((tr.closing_reading - tr.opening_reading - tr.testing) * price) AS total_amt
                FROM t_reading tr
                JOIN m_pump mp ON tr.pump_id = mp.pump_id
                JOIN t_closing tc ON tr.closing_id = tc.closing_id
                WHERE tc.location_code = l_location_code
                  AND tc.closing_id IN (SELECT closing_id
                                        FROM t_cashflow_generation_temp
                                        WHERE session_id = l_session_id)
                  AND tc.closing_status = 'CLOSED'
                GROUP BY mp.pump_code, mp.product_code
            ) a
            GROUP BY product_code
        ) c;

        -- Oil amount (2T Loose / Pouch + non-pump cash sales)
        SELECT ROUND(SUM(a.cash_amt),2) INTO l_oil_amount
        FROM (
            SELECT (given_qty - returned_qty) *
                   CASE
                     WHEN l_location_code IN ('MC','MUE','MC2','MME')
                       THEN (SELECT price
                               FROM m_product
                               WHERE product_name = 'DSR - OIL'
                                 AND location_code = l_location_code)
                     ELSE tc.price
                   END AS cash_amt
            FROM t_2toil tc
            JOIN m_product mp ON tc.product_id = mp.product_id
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            WHERE UPPER(mp.product_name) = '2T LOOSE'
              AND tcl.location_code = l_location_code
              AND tcl.closing_id IN (SELECT closing_id
                                     FROM t_cashflow_generation_temp
                                     WHERE session_id = l_session_id)
              AND tcl.closing_status = 'CLOSED'

            UNION ALL
            SELECT (given_qty - returned_qty) * mp.price
            FROM t_2toil tc
            JOIN m_product mp ON tc.product_id = mp.product_id
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            WHERE UPPER(mp.product_name) = '2T POUCH'
              AND tcl.location_code = l_location_code
              AND tcl.closing_id IN (SELECT closing_id
                                     FROM t_cashflow_generation_temp
                                     WHERE session_id = l_session_id)
              AND tcl.closing_status = 'CLOSED'

            UNION ALL
            SELECT tc.amount
            FROM t_cashsales tc
            JOIN m_product mp ON tc.product_id = mp.product_id
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            WHERE mp.product_name NOT IN (
                      SELECT DISTINCT mp2.product_code
                      FROM t_reading tr
                      JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
                      WHERE tr.closing_id = tcl.closing_id
                  )
              AND tcl.location_code = l_location_code
              AND tcl.closing_id IN (SELECT closing_id
                                     FROM t_cashflow_generation_temp
                                     WHERE session_id = l_session_id)
              AND tcl.closing_status = 'CLOSED'
        ) a;

        -- Digital sales
        SELECT COALESCE(SUM(tds.amount), 0)
        INTO l_digital_amount
        FROM t_digital_sales tds
        JOIN t_closing tc ON tds.closing_id = tc.closing_id
        WHERE tc.location_code = l_location_code
          AND tc.closing_id IN (SELECT closing_id
                                FROM t_cashflow_generation_temp
                                WHERE session_id = l_session_id)
          AND tc.closing_status = 'CLOSED';

        -- Intercompany (bowser fills) — deducted from collection
        -- Valued at weighted-average nozzle price per product per closing
        SELECT COALESCE(SUM(
            tci.quantity * (
                SELECT AVG(tr.price)
                FROM t_reading tr
                JOIN m_pump mp ON tr.pump_id = mp.pump_id
                JOIN m_product mp2 ON mp.product_code = mp2.product_name
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

        SET l_amount = COALESCE(l_amount,0)
                     + COALESCE(l_oil_amount,0)
                     - COALESCE(l_digital_amount,0)
                     - COALESCE(l_intercompany_amount,0);

        SELECT MIN(DATE(tc.closing_date)), MAX(DATE(tc.closing_date))
        INTO l_min_date, l_max_date
        FROM t_closing tc
        WHERE tc.closing_id IN (SELECT closing_id
                                FROM t_cashflow_generation_temp
                                WHERE session_id = l_session_id);

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

        -- 2T Oil adjustment (only for specific locations)
        IF l_location_code IN ('MC2','MME','MC','MUE') THEN
            SELECT SUM(tt.given_qty - tt.returned_qty),
                   SUM(tt.given_qty - tt.returned_qty) *
                       (MAX(mp.price) - (SELECT mp2.price
                                         FROM m_product mp2
                                         WHERE mp2.product_name = 'DSR - OIL'
                                           AND mp2.location_code = l_location_code))
            INTO l_remarks, l_oil_amount
            FROM t_2toil tt
            JOIN t_closing tc ON tc.closing_id = tt.closing_id
            JOIN m_product mp ON tt.product_id = mp.product_id
            WHERE tc.location_code = l_location_code
              AND tc.closing_id IN (SELECT closing_id
                                    FROM t_cashflow_generation_temp
                                    WHERE session_id = l_session_id)
              AND tc.closing_status = 'CLOSED'
              AND mp.product_name = '2T LOOSE';

            IF COALESCE(l_oil_amount, 0) <> 0 THEN
                INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
                VALUES(p_cashflow_id,
                       CONCAT('2T Loose Qty:', COALESCE(l_remarks,'0')),
                       '2T Loose Adjustment', l_oil_amount, 'Y');
            END IF;
        END IF;

    END IF; -- end IF(l_location_code <> 'MCA')

    -- Cash receipts
    SET exit_loop = FALSE;
    OPEN cur_cash_receipts;
    cash_receipts_loop: LOOP
        FETCH cur_cash_receipts INTO l_amount, l_remarks;
        IF exit_loop THEN
            CLOSE cur_cash_receipts;
            LEAVE cash_receipts_loop;
        END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_remarks, 'Receipt', l_amount, 'Y');
        UPDATE t_receipts SET pending_cashflow_id = p_cashflow_id
        WHERE receipt_type = 'Cash'
          AND location_code = l_location_code
          AND cashflow_date IS NULL
          AND (pending_cashflow_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM t_cashflow_closing tcc WHERE tcc.cashflow_id = pending_cashflow_id))
          AND DATE(receipt_date) <= d_cashflow_date
          AND CONCAT(COALESCE((SELECT short_name FROM m_credit_list WHERE creditlist_id = creditlist_id),''),
                     (SELECT company_name FROM m_credit_list WHERE creditlist_id = creditlist_id),
                     ' - Receipt No: ', receipt_no) = l_remarks;
    END LOOP cash_receipts_loop;

    -- Cash expenses
    SET exit_loop = FALSE;
    OPEN cur_cash_expense;
    cash_expense_loop: LOOP
        FETCH cur_cash_expense INTO l_remarks, l_amount;
        IF exit_loop THEN
            CLOSE cur_cash_expense;
            LEAVE cash_expense_loop;
        END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_remarks, 'Expense', l_amount, 'Y');
    END LOOP cash_expense_loop;

    -- Truck expenses
    SET exit_loop = FALSE;
    OPEN cur_tt_expense;
    tt_expense_loop: LOOP
        FETCH cur_tt_expense INTO l_remarks, l_amount;
        IF exit_loop THEN
            CLOSE cur_tt_expense;
            LEAVE tt_expense_loop;
        END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_remarks, 'TT Expense', l_amount, 'Y');
    END LOOP tt_expense_loop;

    -- Salary payouts
    SET exit_loop = FALSE;
    OPEN cur_salary_payout;
    salary_payout_loop: LOOP
        FETCH cur_salary_payout INTO l_remarks, l_amount;
        IF exit_loop THEN
            CLOSE cur_salary_payout;
            LEAVE salary_payout_loop;
        END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_remarks, 'Salary', l_amount, 'Y');
        UPDATE t_employee_payable SET pending_cashflow_id = p_cashflow_id
        WHERE location_code = l_location_code
          AND cashflow_date IS NULL
          AND (pending_cashflow_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM t_cashflow_closing tcc WHERE tcc.cashflow_id = pending_cashflow_id))
          AND DATE(txn_date) <= d_cashflow_date
          AND txn_type IN ('ADVANCE','PAYMENT')
          AND deleted_flag = 'N';
    END LOOP salary_payout_loop;

    -- Salary recoveries
    SET exit_loop = FALSE;
    OPEN cur_salary_recovery;
    salary_recovery_loop: LOOP
        FETCH cur_salary_recovery INTO l_remarks, l_amount;
        IF exit_loop THEN
            CLOSE cur_salary_recovery;
            LEAVE salary_recovery_loop;
        END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_remarks, 'Salary Recovery', l_amount, 'Y');
        UPDATE t_employee_payable SET pending_cashflow_id = p_cashflow_id
        WHERE location_code = l_location_code
          AND cashflow_date IS NULL
          AND (pending_cashflow_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM t_cashflow_closing tcc WHERE tcc.cashflow_id = pending_cashflow_id))
          AND DATE(txn_date) <= d_cashflow_date
          AND txn_type = 'ADVANCE_RECOVERY'
          AND deleted_flag = 'N';
    END LOOP salary_recovery_loop;

    DELETE FROM t_cashflow_generation_temp WHERE session_id = l_session_id;

END ;;

DELIMITER ;

SELECT 'Bowser intercompany adjustments applied: CALCULATE_EXSHORTAGE and generate_cashflow updated.' AS status;
