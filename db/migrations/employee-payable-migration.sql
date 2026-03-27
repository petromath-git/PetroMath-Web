-- ============================================================================
-- employee-payable-migration.sql
-- Employee Payable — Phase 2 of Employee Management
--
-- What this does:
--   1. Create t_employee_payable (cash transactions: salary, advances, recoveries)
--   2. Add remittance_bank_id to m_employee
--   3. Extend m_bank_allowed_ledgers_v with Employee source type
--   4. Triggers on m_employee to auto-seed m_ledger_rules when bank is assigned
--   5. Backfill rules for any existing employees that already have a bank set
--   6. Update generate_cashflow procedure with Salary Payout / Salary Recovery
--   7. New permission ADD_EMPLOYEE_PAYABLE
--
-- Note: ALTER TABLE statements must only be run once. INSERT IGNORE and CREATE OR REPLACE VIEW are idempotent.
-- ============================================================================


-- ── 1. t_employee_payable ────────────────────────────────────────────────────
-- Cash-only financial movements for an employee.
-- SALARY_CREDIT is NOT here — it stays in t_employee_ledger (written by generate_salary).
-- txn_date:             the actual date of the transaction (user-entered).
-- cashflow_date:        NULL until generate_cashflow closes — system-stamped, NOT user-entered.
--                       Same pattern as t_receipts.cashflow_date.
-- pending_cashflow_id:  set by generate_cashflow to claim the row; cleared on close or delete.
-- t_bank_id:            set when auto-posted from a bank statement debit.

CREATE TABLE IF NOT EXISTS t_employee_payable (
    payable_id           INT            NOT NULL AUTO_INCREMENT,
    employee_id          INT            NOT NULL,
    location_code        VARCHAR(50)    NOT NULL,
    txn_date             DATE           NOT NULL,
    txn_type             ENUM(
                             'ADVANCE',           -- cash advance given to employee     (cashflow OUT)
                             'PAYMENT',           -- cash salary payment to employee    (cashflow OUT)
                             'ADVANCE_RECOVERY',  -- advance returned / deducted        (cashflow IN)
                             'DEDUCTION',         -- book deduction (shortage etc.)     (no cashflow)
                             'ADJUSTMENT_CR',     -- book credit adjustment             (no cashflow)
                             'ADJUSTMENT_DR'      -- book debit adjustment              (no cashflow)
                         ) NOT NULL,
    amount               DECIMAL(10,2)  NOT NULL,
    description          VARCHAR(255)   NULL,
    salary_period        VARCHAR(10)    NULL,      -- YYYY-MM or YYYY-WNN, informational
    cashflow_date        DATE           NULL,      -- system-stamped on cashflow close (NULL = unprocessed)
    pending_cashflow_id  INT            NULL,      -- claimed by generate_cashflow; cleared on close/delete
    t_bank_id            INT            NULL,      -- FK to t_bank_transaction if auto-posted from bank
    created_by           VARCHAR(45)    NULL,
    creation_date        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_flag         CHAR(1)        NOT NULL DEFAULT 'N',
    PRIMARY KEY (payable_id),
    KEY idx_ep_employee    (employee_id),
    KEY idx_ep_date        (txn_date),
    KEY idx_ep_cashflow    (cashflow_date),
    KEY idx_ep_pending     (pending_cashflow_id),
    KEY idx_ep_period      (salary_period),
    CONSTRAINT fk_ep_employee
        FOREIGN KEY (employee_id) REFERENCES m_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── 2. Add remittance_bank_id to m_employee ──────────────────────────────────
-- NULL  = employee is paid in cash (no bank statement integration)
-- set   = salary goes via this bank; employee appears in that bank's ledger dropdown

ALTER TABLE m_employee
    ADD COLUMN remittance_bank_id INT NULL
        COMMENT 'Bank used for salary payment. NULL = cash-paid. Seeded into m_ledger_rules via trigger.'
        AFTER photo_doc_id;

ALTER TABLE m_employee
    ADD KEY idx_emp_bank (remittance_bank_id);


-- ── 3. Extend m_bank_allowed_ledgers_v with Employee source type ──────────────
-- Mirrors the existing pattern for Credit / Supplier / Bank / Static.
-- Employee rows: external_id = employee_id, allowed_entry_type = DEBIT
-- (bank pays employee → debit from bank → DEBIT entry type)

CREATE OR REPLACE VIEW m_bank_allowed_ledgers_v AS
SELECT
    lr.rule_id,
    lr.location_code,
    lr.bank_id,
    lr.source_type,
    lr.external_id,
    lr.allowed_entry_type,
    lr.notes_required_flag,
    lr.max_amount,
    CASE
        WHEN lr.source_type = 'Supplier' THEN ms.supplier_name
        WHEN lr.source_type = 'Credit'   THEN CONVERT(mcl.Company_Name USING utf8mb4)
        WHEN lr.source_type = 'Static'   THEN lr.ledger_name
        WHEN lr.source_type = 'Bank'     THEN CONVERT(mb2.ledger_name USING utf8mb4)
        WHEN lr.source_type = 'Employee' THEN CONVERT(me.name USING utf8mb4)
    END AS ledger_name,
    CASE
        WHEN lr.source_type = 'Supplier' THEN ms.supplier_short_name
        WHEN lr.source_type = 'Credit'   THEN CONVERT(mcl.Company_Name USING utf8mb4)
        WHEN lr.source_type = 'Static'   THEN lr.ledger_name
        WHEN lr.source_type = 'Bank'     THEN
            CONVERT(CONCAT(mb2.bank_name,
                   IF(mb2.account_nickname IS NOT NULL AND mb2.account_nickname != '',
                      CONCAT(' (', mb2.account_nickname, ')'), '')) USING utf8mb4)
        WHEN lr.source_type = 'Employee' THEN
            CONVERT(CONCAT(me.name,
                   IF(me.nickname IS NOT NULL AND me.nickname != '',
                      CONCAT(' (', me.nickname, ')'), '')) USING utf8mb4)
    END AS ledger_display_name
FROM m_ledger_rules lr
LEFT JOIN m_supplier ms
    ON  lr.source_type = 'Supplier'
    AND lr.external_id = ms.supplier_id
    AND COALESCE(ms.effective_end_date, '9999-12-31') > CURDATE()
LEFT JOIN m_credit_list mcl
    ON  lr.source_type = 'Credit'
    AND lr.external_id = mcl.creditlist_id
    AND COALESCE(mcl.effective_end_date, '9999-12-31') > CURDATE()
LEFT JOIN m_bank mb2
    ON  lr.source_type = 'Bank'
    AND lr.external_id = mb2.bank_id
    AND mb2.active_flag = 'Y'
LEFT JOIN m_employee me
    ON  lr.source_type = 'Employee'
    AND lr.external_id = me.employee_id
    AND me.is_active   = 'Y'
WHERE lr.source_type = 'Static'
   OR (lr.source_type = 'Supplier' AND ms.supplier_id    IS NOT NULL)
   OR (lr.source_type = 'Credit'   AND mcl.creditlist_id IS NOT NULL)
   OR (lr.source_type = 'Bank'     AND mb2.bank_id       IS NOT NULL)
   OR (lr.source_type = 'Employee' AND me.employee_id    IS NOT NULL)
ORDER BY lr.source_type,
    CASE
        WHEN lr.source_type = 'Supplier' THEN ms.supplier_short_name
        WHEN lr.source_type = 'Credit'   THEN CONVERT(mcl.Company_Name USING utf8mb4)
        WHEN lr.source_type = 'Static'   THEN lr.ledger_name
        WHEN lr.source_type = 'Bank'     THEN
            CONVERT(CONCAT(mb2.bank_name,
                   IF(mb2.account_nickname IS NOT NULL AND mb2.account_nickname != '',
                      CONCAT(' (', mb2.account_nickname, ')'), '')) USING utf8mb4)
        WHEN lr.source_type = 'Employee' THEN
            CONVERT(CONCAT(me.name,
                   IF(me.nickname IS NOT NULL AND me.nickname != '',
                      CONCAT(' (', me.nickname, ')'), '')) USING utf8mb4)
    END;


-- ── 4. Triggers on m_employee ─────────────────────────────────────────────────
-- Mirror of after_creditlist_insert_ledger_rule / after_creditlist_update_ledger_rule.
-- INSERT: if remittance_bank_id is set, seed m_ledger_rules.
-- UPDATE: handle bank change, removal, deactivation, reactivation.

DROP TRIGGER IF EXISTS after_employee_insert_ledger_rule;
DROP TRIGGER IF EXISTS after_employee_update_ledger_rule;

DELIMITER ;;

CREATE TRIGGER after_employee_insert_ledger_rule
AFTER INSERT ON m_employee
FOR EACH ROW
BEGIN
    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN
        IF NEW.remittance_bank_id IS NOT NULL AND NEW.is_active = 'Y' THEN
            INSERT IGNORE INTO m_ledger_rules (
                location_code, bank_id, source_type, external_id,
                ledger_name, allowed_entry_type, notes_required_flag,
                created_by, creation_date, effective_start_date, effective_end_date
            ) VALUES (
                NEW.location_code, NEW.remittance_bank_id, 'Employee', NEW.employee_id,
                NEW.name, 'DEBIT', 'N',
                'system', NOW(), CURDATE(), '2400-01-01'
            );
        END IF;
    END IF;
END;;


CREATE TRIGGER after_employee_update_ledger_rule
AFTER UPDATE ON m_employee
FOR EACH ROW
BEGIN
    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        -- Case A: deactivated OR bank removed → expire rule
        IF (NEW.is_active = 'N' AND OLD.is_active = 'Y')
        OR (NEW.remittance_bank_id IS NULL AND OLD.remittance_bank_id IS NOT NULL) THEN

            UPDATE m_ledger_rules
            SET effective_end_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY),
                updated_by         = 'system',
                updation_date      = NOW()
            WHERE source_type  = 'Employee'
              AND external_id  = NEW.employee_id
              AND (effective_end_date IS NULL OR effective_end_date >= CURDATE());

        -- Case B: bank changed (new bank set, different from old) → expire old, seed new
        ELSEIF NEW.remittance_bank_id IS NOT NULL
           AND NEW.is_active = 'Y'
           AND (OLD.remittance_bank_id IS NULL
                OR NEW.remittance_bank_id != OLD.remittance_bank_id) THEN

            UPDATE m_ledger_rules
            SET effective_end_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY),
                updated_by         = 'system',
                updation_date      = NOW()
            WHERE source_type  = 'Employee'
              AND external_id  = NEW.employee_id
              AND (effective_end_date IS NULL OR effective_end_date >= CURDATE());

            INSERT IGNORE INTO m_ledger_rules (
                location_code, bank_id, source_type, external_id,
                ledger_name, allowed_entry_type, notes_required_flag,
                created_by, creation_date, effective_start_date, effective_end_date
            ) VALUES (
                NEW.location_code, NEW.remittance_bank_id, 'Employee', NEW.employee_id,
                NEW.name, 'DEBIT', 'N',
                'system', NOW(), CURDATE(), '2400-01-01'
            );

        -- Case C: re-activated with a bank set → seed rule
        ELSEIF NEW.is_active = 'Y' AND OLD.is_active = 'N'
           AND NEW.remittance_bank_id IS NOT NULL THEN

            INSERT IGNORE INTO m_ledger_rules (
                location_code, bank_id, source_type, external_id,
                ledger_name, allowed_entry_type, notes_required_flag,
                created_by, creation_date, effective_start_date, effective_end_date
            ) VALUES (
                NEW.location_code, NEW.remittance_bank_id, 'Employee', NEW.employee_id,
                NEW.name, 'DEBIT', 'N',
                'system', NOW(), CURDATE(), '2400-01-01'
            );

        END IF;
    END IF;
END;;

DELIMITER ;


-- ── 5. Backfill — existing employees that already have a bank set ─────────────

INSERT IGNORE INTO m_ledger_rules (
    location_code, bank_id, source_type, external_id,
    ledger_name, allowed_entry_type, notes_required_flag,
    created_by, creation_date, effective_start_date, effective_end_date
)
SELECT
    me.location_code, me.remittance_bank_id, 'Employee', me.employee_id,
    me.name, 'DEBIT', 'N',
    'system', NOW(), CURDATE(), '2400-01-01'
FROM m_employee me
WHERE me.remittance_bank_id IS NOT NULL
  AND me.is_active = 'Y';


-- ── 6. Update generate_cashflow — add Salary Payout / Salary Recovery ─────────
-- Adds two cursors:
--   cur_salary_payout    ADVANCE + PAYMENT   → type 'Salary Payout'  (OUT)
--   cur_salary_recovery  ADVANCE_RECOVERY    → type 'Salary Recovery' (IN)
-- Both filter by location_code and cashflow_date on t_employee_payable.

DELIMITER ;;

DROP PROCEDURE IF EXISTS generate_cashflow;;

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
    DECLARE l_digital_amount DECIMAL(20,2);
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

    -- ── NEW: salary cash-out (ADVANCE + PAYMENT) ──────────────────────────────
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

    -- ── NEW: advance recovery (cash-in from employee) ──────────────────────────
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

    -- Create unique session identifier
    SET l_session_id = CONCAT(CONNECTION_ID(), '_', p_cashflow_id, '_', NOW());

    -- Clean up any old records
    DELETE FROM t_cashflow_generation_temp WHERE session_id = l_session_id;
    DELETE FROM t_debug_msg;
    DELETE FROM t_cashflow_transaction
     WHERE cashflow_id = p_cashflow_id AND calc_flag = 'Y';
    -- Release pending claims (handles regeneration — re-claimed below after each cursor)
    UPDATE t_receipts SET pending_cashflow_id = NULL
    WHERE pending_cashflow_id = p_cashflow_id;
    UPDATE t_employee_payable SET pending_cashflow_id = NULL
    WHERE pending_cashflow_id = p_cashflow_id;

    -- Get location and date
    SELECT location_code, cashflow_date
    INTO l_location_code, d_cashflow_date
    FROM t_cashflow_closing
    WHERE cashflow_id = p_cashflow_id;

    -- Build closing list
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

    -- Insert Balance B/F
    IF l_prev_cashflow_date IS NOT NULL THEN
        SET l_remarks = CONCAT('From Day Close Dated:  ', DATE_FORMAT(l_prev_cashflow_date, '%d/%m/%Y'));
    ELSE
        SET l_remarks = 'Opening Balance - No previous cashflow';
        SET l_cash_bf = 0;
    END IF;

    INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
    VALUES(p_cashflow_id, l_remarks, 'Balance B/F', l_cash_bf, 'Y');

    -- Skip Agro center
    IF(l_location_code <> 'MCA') THEN

        -- Collection calculation
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

        -- Oil amount (CASE-based pricing for 2T Loose)
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

        SET l_amount = COALESCE(l_amount,0)
             + COALESCE(l_oil_amount,0)
             - COALESCE(l_digital_amount,0);

        -- Collection description
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

            INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
            VALUES(p_cashflow_id, l_remarks, '2T Oil', l_oil_amount, 'Y');
        END IF;

        SELECT COALESCE(SUM(cs.price_discount * cs.qty), 0)
        INTO l_pump_discount
        FROM t_cashsales cs
        INNER JOIN m_product mp ON cs.product_id = mp.product_id
        INNER JOIN t_closing tc ON cs.closing_id = tc.closing_id
        WHERE tc.location_code = l_location_code
          AND tc.closing_id IN (SELECT closing_id
                                FROM t_cashflow_generation_temp
                                WHERE session_id = l_session_id)
          AND tc.closing_status = 'CLOSED'
          AND mp.product_name IN (
            SELECT DISTINCT mp2.product_code
            FROM m_pump mp2
            WHERE mp2.location_code = l_location_code
          );

        IF l_pump_discount > 0 THEN
            INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
            VALUES(p_cashflow_id, 'Pump Product Discounts', 'Discount', l_pump_discount, 'Y');
        END IF;

        -- Daily Closing Loop
        SET exit_loop = FALSE;
        OPEN cur_closing_id;
        daily_closing_loop: LOOP
            FETCH cur_closing_id INTO l_closing_id;
            IF exit_loop THEN
                CLOSE cur_closing_id;
                LEAVE daily_closing_loop;
            END IF;
            SELECT CASE WHEN ex_short > 0
                        THEN 'Cashier A/C (+)'
                        ELSE 'Cashier A/C (-)' END,
                   ex_short, person_name
            INTO l_tran_type, l_amount, l_remarks
            FROM t_indiv_closing_sales_v
            WHERE closing_id = l_closing_id;
            IF(l_amount < 0) THEN SET l_amount = l_amount * -1; END IF;
            INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
            VALUES(p_cashflow_id, l_remarks, l_tran_type, l_amount, 'Y');
        END LOOP daily_closing_loop;

    END IF; -- Agro check

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
        VALUES(p_cashflow_id, l_remarks, 'Cash Receipt', l_amount, 'Y');
    END LOOP cash_receipts_loop;

    -- Claim the receipts that were just read — marks them as belonging to this cashflow.
    -- If the cashflow is later deleted, pending_cashflow_id points to nothing and the
    -- cursor's NOT EXISTS check will re-pick them in the next generation.
    UPDATE t_receipts
    SET pending_cashflow_id = p_cashflow_id
    WHERE receipt_type = 'Cash'
      AND location_code = l_location_code
      AND cashflow_date IS NULL
      AND (
          pending_cashflow_id IS NULL
          OR NOT EXISTS (
              SELECT 1 FROM t_cashflow_closing tcc
              WHERE tcc.cashflow_id = pending_cashflow_id
          )
      )
      AND DATE(receipt_date) <= d_cashflow_date;

    -- Cash expense
    SET exit_loop = FALSE;
    OPEN cur_cash_expense;
    expense_loop: LOOP
        FETCH cur_cash_expense INTO l_remarks, l_amount;
        IF exit_loop THEN
            CLOSE cur_cash_expense;
            LEAVE expense_loop;
        END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_remarks, 'Expense', l_amount, 'Y');
    END LOOP expense_loop;

    INSERT INTO t_debug_msg(creation_date, module, msg)
    VALUES(NOW(),'Generate Cashflow','Before tt expense');

    -- Truck expense
    SET exit_loop = FALSE;
    OPEN cur_tt_expense;
    tt_expense_loop: LOOP
        FETCH cur_tt_expense INTO l_remarks, l_amount;
        IF exit_loop THEN
            CLOSE cur_tt_expense;
            LEAVE tt_expense_loop;
        END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_remarks, 'Expense', l_amount, 'Y');
    END LOOP tt_expense_loop;

    INSERT INTO t_debug_msg(creation_date, module, msg)
    VALUES(NOW(),'Generate Cashflow','After tt expense');

    -- ── NEW: Salary payout (ADVANCE + PAYMENT → Salary Payout OUT) ───────────
    SET exit_loop = FALSE;
    OPEN cur_salary_payout;
    salary_payout_loop: LOOP
        FETCH cur_salary_payout INTO l_remarks, l_amount;
        IF exit_loop THEN
            CLOSE cur_salary_payout;
            LEAVE salary_payout_loop;
        END IF;
        INSERT INTO t_cashflow_transaction(cashflow_id, description, type, amount, calc_flag)
        VALUES(p_cashflow_id, l_remarks, 'Salary Payout', l_amount, 'Y');
    END LOOP salary_payout_loop;

    -- ── NEW: Salary recovery (ADVANCE_RECOVERY → Salary Recovery IN) ─────────
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
    END LOOP salary_recovery_loop;

    -- Claim all cashflow-eligible payables that were just read by the two salary cursors.
    UPDATE t_employee_payable
    SET pending_cashflow_id = p_cashflow_id
    WHERE location_code = l_location_code
      AND cashflow_date IS NULL
      AND (
          pending_cashflow_id IS NULL
          OR NOT EXISTS (
              SELECT 1 FROM t_cashflow_closing tcc
              WHERE tcc.cashflow_id = pending_cashflow_id
          )
      )
      AND txn_type    IN ('ADVANCE', 'PAYMENT', 'ADVANCE_RECOVERY')
      AND deleted_flag = 'N'
      AND DATE(txn_date) <= d_cashflow_date;

    -- Update closings
    UPDATE t_closing
    SET cashflow_id = p_cashflow_id
    WHERE closing_id IN (SELECT closing_id
                         FROM t_cashflow_generation_temp
                         WHERE session_id = l_session_id)
      AND cashflow_id IS NULL;

    -- Cleanup temp data
    DELETE FROM t_cashflow_generation_temp
    WHERE session_id = l_session_id;

    INSERT INTO t_debug_msg(creation_date, module, msg)
    VALUES(NOW(),'Generate Cashflow','Generate Cashflow END');

END;;

DELIMITER ;


-- ── 7. Permissions ────────────────────────────────────────────────────────────

INSERT IGNORE INTO m_role_permissions
    (role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, 'ADD_EMPLOYEE_PAYABLE', 0, CURDATE(), '9999-12-31', NULL
FROM m_roles r WHERE r.role_name IN ('Admin', 'SuperUser');


-- ── 8. Fix after_cashflow_close + add pending_cashflow_id to t_receipts ────────
-- Schema: pending_cashflow_id on t_receipts tracks which cashflow has claimed a receipt
--   during generation (before close). No FK — orphan detection is done in the cursor.
--
-- generate_cashflow flow:
--   1. Cleanup: clear pending_cashflow_id for this cashflow_id (regeneration safety)
--   2. Cursor: pick up cashflow_date IS NULL receipts where pending IS NULL
--              OR the pending cashflow no longer exists (deleted cashflow case)
--   3. After loop: set pending_cashflow_id = p_cashflow_id on the same set
--
-- Trigger on close: stamp cashflow_date on receipts where pending_cashflow_id = this cashflow,
--   then clear pending_cashflow_id. Only receipts actually included in generation are stamped.

ALTER TABLE t_receipts
    ADD COLUMN pending_cashflow_id INT NULL
        COMMENT 'Set by generate_cashflow to claim receipt; cleared on cashflow close or delete.',
    ADD KEY idx_receipts_pending_cf (pending_cashflow_id);

DROP TRIGGER IF EXISTS after_cashflow_close;

DELIMITER ;;

CREATE TRIGGER `after_cashflow_close`
AFTER UPDATE ON `t_cashflow_closing`
FOR EACH ROW
BEGIN
    -- ADD TRIGGER GUARD
    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        IF NEW.closing_status = 'CLOSED' THEN

            INSERT INTO t_receipts (
                receipt_no,
                creditlist_id,
                amount,
                receipt_date,
                receipt_type,
                location_code,
                cashflow_date,
                notes,
                created_by,
                updated_by,
                creation_date,
                updation_date,
                source_txn_id
            )
            SELECT
                COALESCE(rmax.max_receipt_no, 0) + rn.row_num AS receipt_no,
                rn.external_id,
                rn.credit_amount,
                CAST(rn.trans_date AS DATETIME) AS receipt_date,
                'Bank Deposit',
                mb.location_code,
                NEW.cashflow_date,
                'Bank Transaction',
                'system',
                'system',
                NOW(),
                NOW(),
                rn.t_bank_id
            FROM (
                SELECT *,
                       ROW_NUMBER() OVER (ORDER BY t_bank_id) AS row_num
                FROM t_bank_transaction
                WHERE
                    COALESCE(closed_flag, 'N') = 'N'
                    AND external_source = 'CREDIT'
                    AND credit_amount > 0
            ) AS rn
            JOIN m_bank mb ON rn.bank_id = mb.bank_id
            LEFT JOIN (
                SELECT MAX(receipt_no) AS max_receipt_no
                FROM t_receipts
                WHERE location_code = NEW.location_code
            ) AS rmax ON TRUE
            WHERE
                mb.location_code = NEW.location_code
                AND NOT EXISTS (
                    SELECT 1
                    FROM t_receipts r
                    WHERE r.source_txn_id = rn.t_bank_id
                );

            UPDATE t_bank_transaction
            SET closed_flag = 'Y',
                closed_date = NEW.cashflow_date
            WHERE COALESCE(closed_flag, 'N') = 'N'
              AND bank_id IN (
                  SELECT bank_id FROM m_bank WHERE location_code = NEW.location_code
              );

            UPDATE t_receipts
            SET cashflow_date = NEW.cashflow_date
            WHERE cashflow_date IS NULL
              AND location_code = NEW.location_code
              AND receipt_type != 'Cash';

            -- Stamp only the cash receipts that were claimed by this cashflow during
            -- generation (pending_cashflow_id set in generate_cashflow after cursor loop).
            -- Receipts entered after generation but before close are NOT claimed and
            -- will be swept by the next cashflow's cursor.
            UPDATE t_receipts
            SET cashflow_date       = NEW.cashflow_date,
                pending_cashflow_id = NULL
            WHERE pending_cashflow_id = NEW.cashflow_id;

            -- Same pattern for employee payables (ADVANCE / PAYMENT / ADVANCE_RECOVERY).
            UPDATE t_employee_payable
            SET cashflow_date       = NEW.cashflow_date,
                pending_cashflow_id = NULL
            WHERE pending_cashflow_id = NEW.cashflow_id;

            UPDATE t_tank_stk_rcpt
            SET cashflow_date = NEW.cashflow_date
            WHERE cashflow_date IS NULL
              AND location_code = NEW.location_code;

            CALL generate_closing_Stock(NEW.location_code, NEW.cashflow_date, NEW.cashflow_date);

        END IF;

    END IF; -- End trigger guard
END;;

DELIMITER ;

