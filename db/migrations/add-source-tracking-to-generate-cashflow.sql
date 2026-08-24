-- ============================================================
-- generate_cashflow: populate source_table/source_id on Cash
-- Receipt and Salary Payout/Recovery entries
--
-- Companion to add-source-tracking-to-cashflow-transaction.sql.
-- Only three things changed from the live procedure (confirmed via
-- SHOW CREATE PROCEDURE, not the possibly-stale copy in this repo's
-- earlier migration files):
--   1. New DECLARE l_source_id INT
--   2. cur_cash_receipts / cur_salary_payout / cur_salary_recovery
--      cursors additionally SELECT the source row's PK
--   3. Their three INSERTs into t_cashflow_transaction carry
--      source_table/source_id through
-- Every other cursor, insert, and calculation is byte-for-byte
-- unchanged from the live version.
--
-- Full re-declaration. Safe to re-run: uses DROP PROCEDURE IF EXISTS.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS generate_cashflow$$

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
    DECLARE l_collection_desc VARCHAR(200);
    DECLARE l_min_date, l_max_date DATE;

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
          AND DATE(el.txn_date) <= d_cashflow_date
          AND el.txn_type = 'ADVANCE_RECOVERY'
          AND el.credit_amount > 0;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET exit_loop = TRUE;

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
                      AND COALESCE(tcr.off_meter_sale, 0) = 0
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

        SELECT ROUND(SUM(a.cash_amt),2) INTO l_oil_amount
        FROM (
            SELECT (given_qty - returned_qty) *
                   CASE
                     WHEN l_location_code IN ('MC','MUE','MC2','MME')
                       THEN (SELECT price FROM m_product
                              WHERE product_name = 'DSR - OIL'
                                AND location_code = l_location_code)
                     ELSE tc.price
                   END AS cash_amt
            FROM t_2toil tc
            JOIN m_product mp ON tc.product_id = mp.product_id
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            WHERE UPPER(mp.product_name) = '2T LOOSE'
              AND tcl.location_code = l_location_code
              AND tcl.closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id)
              AND tcl.closing_status = 'CLOSED'

            UNION ALL
            SELECT (given_qty - returned_qty) * mp.price
            FROM t_2toil tc
            JOIN m_product mp ON tc.product_id = mp.product_id
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            WHERE UPPER(mp.product_name) = '2T POUCH'
              AND tcl.location_code = l_location_code
              AND tcl.closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id)
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
                                          WHERE mp2.product_name = 'DSR - OIL'
                                            AND mp2.location_code = l_location_code))
            INTO l_remarks, l_oil_amount
            FROM t_2toil tt
            JOIN t_closing tc ON tc.closing_id = tt.closing_id
            JOIN m_product mp ON tt.product_id = mp.product_id
            WHERE tc.location_code = l_location_code
              AND tc.closing_id IN (SELECT closing_id FROM t_cashflow_generation_temp WHERE session_id = l_session_id)
              AND tc.closing_status = 'CLOSED'
              AND mp.product_name = '2T LOOSE';

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
          AND mp.product_name IN (
              SELECT DISTINCT mp2.product_code FROM m_pump mp2 WHERE mp2.location_code = l_location_code
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
        FETCH cur_salary_payout INTO l_remarks, l_amount, l_source_id;
        IF exit_loop THEN CLOSE cur_salary_payout; LEAVE salary_payout_loop; END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag, source_table, source_id)
        VALUES(p_cashflow_id, l_remarks, 'Salary Payout', l_amount, 'Y', 't_employee_ledger', l_source_id);
    END LOOP salary_payout_loop;


    SET exit_loop = FALSE;
    OPEN cur_salary_recovery;
    salary_recovery_loop: LOOP
        FETCH cur_salary_recovery INTO l_remarks, l_amount, l_source_id;
        IF exit_loop THEN CLOSE cur_salary_recovery; LEAVE salary_recovery_loop; END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag, source_table, source_id)
        VALUES(p_cashflow_id, l_remarks, 'Salary Recovery', l_amount, 'Y', 't_employee_ledger', l_source_id);
    END LOOP salary_recovery_loop;


    UPDATE t_employee_ledger
    SET pending_cashflow_id = p_cashflow_id
    WHERE location_code = l_location_code
      AND cashflow_date IS NULL
      AND (pending_cashflow_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM t_cashflow_closing tcc WHERE tcc.cashflow_id = pending_cashflow_id))
      AND txn_type IN ('ADVANCE', 'PAYMENT', 'ADVANCE_RECOVERY')
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
