-- ============================================================
-- Salary heads split: Salary Advance / Salary Advance Recovery / Salary Payout
-- Generated: 2026-10-09
--
-- Advance (balance sheet) and cash salary (P&L) were posted as one
-- "Salary Payout" Day Close line. They become three standard Day Close
-- (Static, cashflow-rule) heads at every location:
--   Salary Advance           DEBIT   <- t_employee_ledger ADVANCE
--   Salary Payout            DEBIT   <- t_employee_ledger PAYMENT
--   Salary Advance Recovery  CREDIT  <- t_employee_ledger ADVANCE_RECOVERY
--
-- 1. Account heads (data, one transaction, rolled back if checks fail):
--    - "Salary Recovery" renamed to "Salary Advance Recovery" (same id, so
--      history stays attached); where a location already has a
--      "SALARY ADVANCE RECOVERY" head (MME) that one is used instead and the
--      old "Salary Recovery" loses its cashflow rule and system flag.
--    - "SALARY ADVANCES"/"SALARY ADVANCE" (MC, MME, MC2, SFS) renamed to
--      "Salary Advance"; created new everywhere else. SFS keeps BOTH (it has
--      bank lines); MC2's unused BOTH head becomes DEBIT.
--    - Renames follow AccountHeadsDao.updateAccountHead: ledger rule name
--      updated, GL Control mapping (gl_static_ledger_map) copied to the new
--      name, old mapping row kept.
-- 2. trg_cashflow_txn_account_head_insert/update: direction fallback for the
--    new names (needed for SFS's BOTH head).
-- 3. trg_location_seed_data: new locations get the three heads.
-- 4. generate_cashflow: ADVANCE -> "Salary Advance", PAYMENT -> "Salary
--    Payout", ADVANCE_RECOVERY -> "Salary Advance Recovery".
-- 5. after_cashflow_close also stamps t_employee_ledger (was only the old
--    t_employee_payable); backfill rows already in CLOSED Day Closes.
--
-- Objects 2-5 are the live prod definitions (identical logic on dev,
-- 2026-10-09) with only the changes above. Trigger timing/order unchanged.
-- Must deploy together with the app change in the same PR
-- (txn-write-dao shift-reopen release, cashflow-closing-dao reopen).
-- ============================================================

SET SESSION sql_mode = 'ALLOW_INVALID_DATES,NO_ENGINE_SUBSTITUTION';

-- ---------- 1. Account heads ----------
DROP PROCEDURE IF EXISTS tmp_salary_heads_split;
DELIMITER $$
CREATE PROCEDURE tmp_salary_heads_split()
BEGIN
    DECLARE v_bad INT DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    -- Guards: a location must not have two candidate heads for one slot
    SELECT COUNT(*) INTO v_bad FROM (
        SELECT location_code FROM m_account_heads
        WHERE account_head_name IN ('SALARY ADVANCES', 'SALARY ADVANCE')
        GROUP BY location_code HAVING COUNT(*) > 1) x;
    IF v_bad > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A location has more than one Salary Advance candidate head';
    END IF;
    SELECT COUNT(*) INTO v_bad FROM (
        SELECT location_code FROM m_account_heads
        WHERE account_head_name = 'Salary Advance Recovery'
        GROUP BY location_code HAVING COUNT(*) > 1) x;
    IF v_bad > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A location has more than one Salary Advance Recovery head';
    END IF;

    START TRANSACTION;

    DROP TEMPORARY TABLE IF EXISTS tmp_sal_ren;
    CREATE TEMPORARY TABLE tmp_sal_ren (
        account_head_id INT PRIMARY KEY,
        location_code   VARCHAR(50),
        old_name        VARCHAR(250),
        new_name        VARCHAR(250));
    DROP TEMPORARY TABLE IF EXISTS tmp_sal_retire;
    CREATE TEMPORARY TABLE tmp_sal_retire (account_head_id INT PRIMARY KEY);

    -- Existing advance heads -> "Salary Advance" (MC, MME, MC2, SFS)
    INSERT INTO tmp_sal_ren
    SELECT account_head_id, location_code, account_head_name, 'Salary Advance'
    FROM m_account_heads
    WHERE account_head_name IN ('SALARY ADVANCES', 'SALARY ADVANCE');

    -- Existing advance-recovery head (MME) becomes the standard one
    INSERT INTO tmp_sal_ren
    SELECT account_head_id, location_code, account_head_name, 'Salary Advance Recovery'
    FROM m_account_heads
    WHERE account_head_name = 'Salary Advance Recovery';

    -- ...and that location's "Salary Recovery" is retired from Day Close
    INSERT INTO tmp_sal_retire
    SELECT ah.account_head_id
    FROM m_account_heads ah
    WHERE ah.account_head_name = 'Salary Recovery'
      AND ah.location_code IN (SELECT location_code FROM tmp_sal_ren WHERE new_name = 'Salary Advance Recovery');

    -- Everywhere else "Salary Recovery" is renamed
    INSERT INTO tmp_sal_ren
    SELECT ah.account_head_id, ah.location_code, ah.account_head_name, 'Salary Advance Recovery'
    FROM m_account_heads ah
    WHERE ah.account_head_name = 'Salary Recovery'
      AND ah.account_head_id NOT IN (SELECT account_head_id FROM tmp_sal_retire);

    UPDATE m_ledger_rules r
    JOIN tmp_sal_retire t ON r.source_type = 'Static' AND r.external_id = t.account_head_id
       SET r.applies_to_cashflow = 'N', r.updated_by = 'system', r.updation_date = NOW();
    UPDATE m_account_heads ah
    JOIN tmp_sal_retire t ON t.account_head_id = ah.account_head_id
       SET ah.is_system_type = 'N', ah.updated_by = 'system', ah.updation_date = NOW();

    -- GL Control mapping follows the rename (old row kept for history)
    INSERT IGNORE INTO gl_static_ledger_map
        (location_code, ledger_name, treatment, gl_ledger_id, skip_reason, bank_id, created_by, updated_by)
    SELECT m.location_code, t.new_name, m.treatment, m.gl_ledger_id, m.skip_reason, m.bank_id, 'system', 'system'
    FROM tmp_sal_ren t
    JOIN gl_static_ledger_map m ON m.location_code = t.location_code AND m.ledger_name = t.old_name
    WHERE t.old_name <> t.new_name;

    UPDATE m_account_heads ah
    JOIN tmp_sal_ren t ON t.account_head_id = ah.account_head_id
       SET ah.account_head_name = t.new_name, ah.is_system_type = 'Y',
           ah.updated_by = 'system', ah.updation_date = NOW();
    UPDATE m_ledger_rules r
    JOIN tmp_sal_ren t ON r.source_type = 'Static' AND r.external_id = t.account_head_id
       SET r.ledger_name = t.new_name, r.updated_by = 'system', r.updation_date = NOW();

    -- A BOTH advance head with no bank lines (MC2) becomes DEBIT; SFS keeps BOTH
    UPDATE m_ledger_rules r
    JOIN m_account_heads ah ON r.source_type = 'Static' AND r.external_id = ah.account_head_id
       SET r.allowed_entry_type = 'DEBIT', r.updated_by = 'system', r.updation_date = NOW()
     WHERE ah.account_head_name = 'Salary Advance' AND ah.allowed_entry_type = 'BOTH'
       AND r.applies_to_cashflow = 'Y'
       AND NOT EXISTS (SELECT 1 FROM t_bank_transaction b
                       WHERE b.external_source = 'Static' AND b.external_id = ah.account_head_id);
    UPDATE m_account_heads ah
       SET ah.allowed_entry_type = 'DEBIT', ah.updated_by = 'system', ah.updation_date = NOW()
     WHERE ah.account_head_name = 'Salary Advance' AND ah.allowed_entry_type = 'BOTH'
       AND NOT EXISTS (SELECT 1 FROM t_bank_transaction b
                       WHERE b.external_source = 'Static' AND b.external_id = ah.account_head_id);

    -- Create the heads where still missing
    INSERT INTO m_account_heads
        (location_code, account_head_name, allowed_entry_type, is_system_type,
         effective_start_date, created_by, updated_by)
    SELECT l.location_code, n.name, n.entry_type, 'Y', CURDATE(), 'system', 'system'
    FROM (SELECT DISTINCT location_code FROM m_account_heads WHERE account_head_name = 'Salary Payout') l
    CROSS JOIN (SELECT 'Salary Advance' name, 'DEBIT' entry_type
                UNION ALL SELECT 'Salary Advance Recovery', 'CREDIT') n
    WHERE NOT EXISTS (SELECT 1 FROM m_account_heads x
                      WHERE x.location_code = l.location_code AND x.account_head_name = n.name);

    -- Day Close (cashflow) rule where missing
    INSERT INTO m_ledger_rules
        (location_code, source_type, external_id, ledger_name, allowed_entry_type,
         applies_to_cashflow, display_sequence, created_by, updated_by)
    SELECT ah.location_code, 'Static', ah.account_head_id, ah.account_head_name,
           CASE ah.account_head_name WHEN 'Salary Advance' THEN 'DEBIT' ELSE 'CREDIT' END,
           'Y',
           CASE ah.account_head_name WHEN 'Salary Advance' THEN 95 ELSE 100 END,
           'system', 'system'
    FROM m_account_heads ah
    WHERE ah.account_head_name IN ('Salary Advance', 'Salary Advance Recovery')
      AND NOT EXISTS (SELECT 1 FROM m_ledger_rules r
                      WHERE r.source_type = 'Static' AND r.external_id = ah.account_head_id
                        AND r.applies_to_cashflow = 'Y');

    -- Register new names on the GL Control review screen
    INSERT IGNORE INTO gl_static_ledger_map (location_code, ledger_name, created_by, updated_by)
    SELECT location_code, account_head_name, 'system', 'system'
    FROM m_account_heads
    WHERE account_head_name IN ('Salary Advance', 'Salary Advance Recovery');

    -- Verify: every location has exactly one system head of each, each with a Day Close rule
    SELECT COUNT(*) INTO v_bad FROM (
        SELECT l.location_code
        FROM (SELECT DISTINCT location_code FROM m_account_heads WHERE account_head_name = 'Salary Payout') l
        LEFT JOIN m_account_heads a
               ON a.location_code = l.location_code
              AND a.account_head_name IN ('Salary Advance', 'Salary Advance Recovery', 'Salary Payout')
              AND a.is_system_type = 'Y'
              AND EXISTS (SELECT 1 FROM m_ledger_rules r WHERE r.source_type = 'Static'
                            AND r.external_id = a.account_head_id AND r.applies_to_cashflow = 'Y')
        GROUP BY l.location_code
        HAVING COUNT(DISTINCT a.account_head_name) <> 3 OR COUNT(a.account_head_id) <> 3) x;
    IF v_bad > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Verification failed: a location does not have exactly the three salary heads with Day Close rules';
    END IF;

    COMMIT;

    SELECT old_name, new_name, COUNT(*) AS heads, GROUP_CONCAT(location_code ORDER BY location_code) AS locations
    FROM tmp_sal_ren GROUP BY old_name, new_name;
    SELECT 'retired from Day Close' AS action, GROUP_CONCAT(ah.location_code) AS locations
    FROM tmp_sal_retire t JOIN m_account_heads ah ON ah.account_head_id = t.account_head_id;
END$$
DELIMITER ;

CALL tmp_salary_heads_split();
DROP PROCEDURE tmp_salary_heads_split;

-- ---------- 2. Account-head match triggers ----------

DROP TRIGGER IF EXISTS trg_cashflow_txn_account_head_insert;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_cashflow_txn_account_head_insert BEFORE INSERT ON t_cashflow_transaction FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);

    IF NEW.type IS NOT NULL THEN
        SELECT location_code INTO v_location_code
        FROM t_cashflow_closing WHERE cashflow_id = NEW.cashflow_id;

        IF v_location_code IS NOT NULL THEN
            IF NEW.account_head_id IS NULL THEN
                SET @v_ah = NULL;
                SELECT account_head_id INTO @v_ah
                FROM m_account_heads
                WHERE location_code = v_location_code AND account_head_name = NEW.type
                LIMIT 1;
                SET NEW.account_head_id = @v_ah;
            END IF;

            IF NEW.entry_type IS NULL THEN
                SET @v_et = NULL;
                SELECT CASE allowed_entry_type WHEN 'BOTH' THEN NULL ELSE allowed_entry_type END INTO @v_et
                FROM m_account_heads
                WHERE account_head_id = NEW.account_head_id;

                IF @v_et IS NULL THEN
                    SET @v_et = CASE NEW.type
                        WHEN 'Balance B/F' THEN 'CREDIT'
                        WHEN 'Collection' THEN 'CREDIT'
                        WHEN '2T Oil' THEN 'CREDIT'
                        WHEN 'Discount' THEN 'DEBIT'
                        WHEN 'Cashier A/C (+)' THEN 'CREDIT'
                        WHEN 'Cashier A/C (-)' THEN 'DEBIT'
                        WHEN 'Cash Receipt' THEN 'CREDIT'
                        WHEN 'Expense' THEN 'DEBIT'
                        WHEN 'Salary Payout' THEN 'DEBIT'
                        WHEN 'Salary Recovery' THEN 'CREDIT'
                        WHEN 'Salary Advance' THEN 'DEBIT'
                        WHEN 'Salary Advance Recovery' THEN 'CREDIT'
                        ELSE NULL
                    END;
                END IF;
                SET NEW.entry_type = @v_et;
            END IF;
        END IF;
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_cashflow_txn_account_head_update;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_cashflow_txn_account_head_update BEFORE UPDATE ON t_cashflow_transaction FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);

    IF NOT (OLD.type <=> NEW.type) THEN
        SELECT location_code INTO v_location_code
        FROM t_cashflow_closing WHERE cashflow_id = NEW.cashflow_id;

        IF v_location_code IS NOT NULL THEN
            SET @v_ah = NULL;
            SELECT account_head_id INTO @v_ah
            FROM m_account_heads
            WHERE location_code = v_location_code AND account_head_name = NEW.type
            LIMIT 1;
            SET NEW.account_head_id = @v_ah;

            SET @v_et = NULL;
            SELECT CASE allowed_entry_type WHEN 'BOTH' THEN NULL ELSE allowed_entry_type END INTO @v_et
            FROM m_account_heads
            WHERE account_head_id = @v_ah;

            IF @v_et IS NULL THEN
                SET @v_et = CASE NEW.type
                    WHEN 'Balance B/F' THEN 'CREDIT'
                    WHEN 'Collection' THEN 'CREDIT'
                    WHEN '2T Oil' THEN 'CREDIT'
                    WHEN 'Discount' THEN 'DEBIT'
                    WHEN 'Cashier A/C (+)' THEN 'CREDIT'
                    WHEN 'Cashier A/C (-)' THEN 'DEBIT'
                    WHEN 'Cash Receipt' THEN 'CREDIT'
                    WHEN 'Expense' THEN 'DEBIT'
                    WHEN 'Salary Payout' THEN 'DEBIT'
                    WHEN 'Salary Recovery' THEN 'CREDIT'
                    WHEN 'Salary Advance' THEN 'DEBIT'
                    WHEN 'Salary Advance Recovery' THEN 'CREDIT'
                    ELSE NULL
                END;
            END IF;
            SET NEW.entry_type = COALESCE(@v_et, NEW.entry_type);
        END IF;
    END IF;
END$$
DELIMITER ;


-- ---------- 3. Location seed trigger (new locations) ----------

DROP TRIGGER IF EXISTS trg_location_seed_data;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_location_seed_data AFTER INSERT ON m_location FOR EACH ROW
BEGIN
    DECLARE v_supplier_id     INT;
    DECLARE v_template_id     INT;
    DECLARE v_bank_name       VARCHAR(150);
    DECLARE v_supplier_name   VARCHAR(200);
    DECLARE v_dt_group_id     INT;

    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        -- Insert Petty Cash Expenses
        INSERT INTO m_expense
            (Expense_name, location_code, Expense_default_amt, created_by, updated_by, updation_date, creation_date)
        VALUES
            ('Tiffin',         NEW.location_code, 200, 'admin', 'admin', NOW(), NOW()),
            ('Tea',            NEW.location_code,  30, 'admin', 'admin', NOW(), NOW()),
            ('Bus Fare',       NEW.location_code,  30, 'admin', 'admin', NOW(), NOW()),
            ('TT Driver Batta',NEW.location_code, 100, 'admin', 'admin', NOW(), NOW()),
            ('Others',         NEW.location_code,   0, 'admin', 'admin', NOW(), NOW());

        -- Seed cashflow Account Heads (supersedes the old m_lookup 'CashFlow' seed)
        INSERT INTO m_account_heads
            (location_code, account_head_name, allowed_entry_type, is_system_type,
             effective_start_date, created_by, updated_by)
        VALUES
            (NEW.location_code, 'Balance B/F',       'CREDIT', 'Y', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Collection',         'CREDIT', 'Y', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Cash Receipt',       'CREDIT', 'Y', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Cashier A/C (+)',    'CREDIT', 'Y', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Cashier A/C (-)',    'DEBIT',  'Y', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Discount',           'DEBIT',  'Y', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Expense',            'DEBIT',  'Y', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Salary Payout',      'DEBIT',  'Y', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Salary Advance',     'DEBIT',  'Y', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Salary Advance Recovery', 'CREDIT', 'Y', CURDATE(), 'admin', 'admin'),            
            (NEW.location_code, 'To Bank',            'DEBIT',  'N', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'To Deposits',        'CREDIT', 'N', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'To WithDrawals',     'DEBIT',  'N', CURDATE(), 'admin', 'admin');

        -- Matching cashflow-scoped Ledger Rules
        INSERT INTO m_ledger_rules
            (location_code, source_type, external_id, ledger_name, allowed_entry_type,
             applies_to_cashflow, display_sequence, created_by, updated_by)
        SELECT mah.location_code, 'Static', mah.account_head_id, mah.account_head_name,
               mah.allowed_entry_type, 'Y', seq.display_sequence, 'admin', 'admin'
        FROM m_account_heads mah
        JOIN (
            SELECT 'Balance B/F' name, 10 display_sequence
            UNION ALL SELECT 'Collection', 20
            UNION ALL SELECT 'Cash Receipt', 40
            UNION ALL SELECT 'Cashier A/C (+)', 50
            UNION ALL SELECT 'Cashier A/C (-)', 60
            UNION ALL SELECT 'Discount', 70
            UNION ALL SELECT 'Expense', 80
            UNION ALL SELECT 'Salary Payout', 90
            UNION ALL SELECT 'Salary Advance', 95
            UNION ALL SELECT 'Salary Advance Recovery', 100            
            UNION ALL SELECT 'To Bank', 130
            UNION ALL SELECT 'To Deposits', 140
            UNION ALL SELECT 'To WithDrawals', 150
        ) seq ON seq.name = mah.account_head_name
        WHERE mah.location_code = NEW.location_code;

        -- Proactive gl_static_ledger_map registration (mirrors AccountHeadsDao.createAccountHead)
        INSERT IGNORE INTO gl_static_ledger_map (location_code, ledger_name, created_by, updated_by)
        SELECT mah.location_code, mah.account_head_name, 'admin', 'admin'
        FROM m_account_heads mah
        WHERE mah.location_code = NEW.location_code
          AND mah.account_head_name IN
              ('Balance B/F','Collection','Cash Receipt','Cashier A/C (+)','Cashier A/C (-)',
               'Discount','Expense','Salary Payout','Salary Advance','Salary Advance Recovery',
               'To Bank','To Deposits','To WithDrawals');

        -- Seed Output GST ledgers under Duties & Taxes
        SELECT group_id INTO v_dt_group_id
        FROM gl_ledger_groups
        WHERE location_code = NEW.location_code
          AND group_name    = 'Duties & Taxes'
        LIMIT 1;

        IF v_dt_group_id IS NOT NULL THEN
            INSERT INTO gl_ledgers (location_code, ledger_name, group_id, active_flag, created_by, updated_by)
            VALUES (NEW.location_code, 'OUTPUT CGST', v_dt_group_id, 'Y', 'system', 'system');

            INSERT INTO gl_ledgers (location_code, ledger_name, group_id, active_flag, created_by, updated_by)
            VALUES (NEW.location_code, 'OUTPUT SGST', v_dt_group_id, 'Y', 'system', 'system');
        END IF;

        -- Auto-create oil company supplier + SOA bank
        -- The after_supplier_insert_ledger_rule trigger on m_supplier fires automatically.
        IF NEW.company_name IN ('IOCL', 'BPCL', 'HPCL', 'NAYARA') THEN

            SET v_supplier_name = CASE NEW.company_name
                WHEN 'IOCL'   THEN 'Indian Oil Corporation Limited'
                WHEN 'BPCL'   THEN 'Bharat Petroleum Corporation Limited'
                WHEN 'HPCL'   THEN 'Hindustan Petroleum Corporation Limited'
                WHEN 'NAYARA' THEN 'Nayara Energy Limited'
            END;

            SET v_bank_name = CASE NEW.company_name
                WHEN 'IOCL'   THEN 'IOCL-SOA'
                WHEN 'BPCL'   THEN 'BPCL-SOA'
                WHEN 'HPCL'   THEN 'HPCL-SOA'
                WHEN 'NAYARA' THEN 'NAYARA-SOA'
            END;

            -- template_id=2: IOCL SAP Account Statement
            -- template_id=6: BPCL SAP SOA Format
            SET v_template_id = CASE NEW.company_name
                WHEN 'IOCL'   THEN 2
                WHEN 'BPCL'   THEN 6
                ELSE NULL
            END;

            INSERT INTO m_supplier
                (supplier_name, supplier_short_name, location_id, location_code,
                 created_by, updated_by, creation_date, updation_date)
            VALUES (
                v_supplier_name,
                NEW.company_name,
                NEW.location_id,
                NEW.location_code,
                'system', 'system', NOW(), NOW()
            );

            SET v_supplier_id = LAST_INSERT_ID();

            INSERT INTO m_bank
                (bank_name, bank_branch, account_number, ifsc_code,
                 location_code, location_id, is_oil_company, active_flag, internal_flag,
                 template_id, supplier_id, created_by, updated_by)
            VALUES (
                v_bank_name, 'N/A', 'N/A', 'N/A',
                NEW.location_code, NEW.location_id, 'Y', 'Y', 'N',
                v_template_id, v_supplier_id, 'system', 'system'
            );

        END IF;

    END IF;
END$$
DELIMITER ;


-- ---------- 4. generate_cashflow ----------

DROP PROCEDURE IF EXISTS generate_cashflow;
DELIMITER $$
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


-- ---------- 5. Close trigger + backfill ----------

DROP TRIGGER IF EXISTS after_cashflow_close;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER after_cashflow_close AFTER UPDATE ON t_cashflow_closing FOR EACH ROW
BEGIN
    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        IF NEW.closing_status = 'CLOSED' THEN

            -- ── INSERT #1: Non-split Credit bank transactions ─────────────────
            --    Identical to the original trigger logic, with the addition of
            --    AND IFNULL(is_split, 'N') = 'N' to skip split parents.
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
                source_txn_id,
                source_split_id
            )
            SELECT
                COALESCE(rmax.max_receipt_no, 0) + rn.row_num AS receipt_no,
                rn.external_id,
                rn.credit_amount,
                CAST(rn.trans_date AS DATETIME)               AS receipt_date,
                'Bank Deposit',
                mb.location_code,
                NEW.cashflow_date,
                'Bank Transaction',
                'system',
                'system',
                NOW(),
                NOW(),
                rn.t_bank_id,
                NULL                                          -- not a split receipt
            FROM (
                SELECT *,
                       ROW_NUMBER() OVER (ORDER BY t_bank_id) AS row_num
                FROM t_bank_transaction
                WHERE COALESCE(closed_flag, 'N') = 'N'
                  AND external_source            = 'CREDIT'
                  AND credit_amount              > 0
                  AND IFNULL(is_split, 'N')      = 'N'        -- ← skip split parents
            ) AS rn
            JOIN m_bank mb ON rn.bank_id = mb.bank_id
            LEFT JOIN (
                SELECT MAX(receipt_no) AS max_receipt_no
                FROM t_receipts
                WHERE location_code = NEW.location_code
            ) AS rmax ON TRUE
            WHERE mb.location_code = NEW.location_code
              AND NOT EXISTS (
                  SELECT 1 FROM t_receipts r
                  WHERE r.source_txn_id = rn.t_bank_id
                    AND r.source_split_id IS NULL
              );

            -- ── INSERT #2: Split Credit allocations ───────────────────────────
            --    For each split row that is a Credit allocation and whose parent
            --    is open (closed_flag = 'N') at this location, create one receipt.
            --    Dedup guard uses source_split_id so all N splits are created even
            --    when they share the same parent t_bank_id.
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
                source_txn_id,
                source_split_id
            )
            SELECT
                COALESCE(rmax2.max_receipt_no, 0) + ROW_NUMBER() OVER (ORDER BY s.split_id) AS receipt_no,
                s.external_id,
                s.amount,
                CAST(tbt.trans_date AS DATETIME)                AS receipt_date,
                'Bank Deposit',
                mb.location_code,
                NEW.cashflow_date,
                CASE
                    WHEN s.remarks IS NOT NULL AND s.remarks != ''
                    THEN CONCAT('Split from Bank - ', s.remarks)
                    ELSE 'Split from Bank'
                END,
                'system',
                'system',
                NOW(),
                NOW(),
                tbt.t_bank_id,
                s.split_id
            FROM t_bank_transaction_splits s
            JOIN t_bank_transaction tbt ON s.t_bank_id = tbt.t_bank_id
            JOIN m_bank mb              ON tbt.bank_id = mb.bank_id
            LEFT JOIN (
                SELECT MAX(receipt_no) AS max_receipt_no
                FROM t_receipts
                WHERE location_code = NEW.location_code
            ) AS rmax2 ON TRUE
            WHERE mb.location_code          = NEW.location_code
              AND s.external_source         = 'CREDIT'
              AND s.amount                  > 0
              AND s.external_id             IS NOT NULL
              AND COALESCE(tbt.closed_flag, 'N') = 'N'        -- parent still open
              AND NOT EXISTS (
                  SELECT 1 FROM t_receipts r
                  WHERE r.source_split_id = s.split_id
              );

            -- ── Close all open bank transactions for this location ────────────
            UPDATE t_bank_transaction
            SET closed_flag = 'Y',
                closed_date = NEW.cashflow_date
            WHERE COALESCE(closed_flag, 'N') = 'N'
              AND bank_id IN (
                  SELECT bank_id FROM m_bank WHERE location_code = NEW.location_code
              );

            -- ── Stamp cashflow_date on all unclaimed non-cash receipts ────────
            --    This covers both non-split receipts AND split receipts that were
            --    created by INSERT #2 above (cashflow_date = NEW.cashflow_date
            --    already set in the INSERT, so this UPDATE is a no-op for them,
            --    but harmless and kept for clarity).
            UPDATE t_receipts
            SET cashflow_date = NEW.cashflow_date
            WHERE cashflow_date IS NULL
              AND location_code = NEW.location_code
              AND receipt_type != 'Cash';

            -- Stamp cash receipts claimed during generate_cashflow
            UPDATE t_receipts
            SET cashflow_date       = NEW.cashflow_date,
                pending_cashflow_id = NULL
            WHERE pending_cashflow_id = NEW.cashflow_id;

            -- Stamp employee payables
            UPDATE t_employee_payable
            SET cashflow_date       = NEW.cashflow_date,
                pending_cashflow_id = NULL
            WHERE pending_cashflow_id = NEW.cashflow_id;

            -- Employee ledger cash entries claimed by this Day Close (Salary
            -- Advance / Payout / Advance Recovery lines). Was missing: rows kept
            -- pending_cashflow_id forever and never got a cashflow_date.
            UPDATE t_employee_ledger
            SET cashflow_date       = NEW.cashflow_date,
                pending_cashflow_id = NULL
            WHERE pending_cashflow_id = NEW.cashflow_id;

            -- Stamp stock receipts
            UPDATE t_tank_stk_rcpt
            SET cashflow_date = NEW.cashflow_date
            WHERE cashflow_date IS NULL
              AND location_code = NEW.location_code;

            CALL generate_closing_Stock(NEW.location_code, NEW.cashflow_date, NEW.cashflow_date);

        END IF;

    END IF;
END$$
DELIMITER ;

-- Backfill: employee ledger rows claimed by an already-CLOSED Day Close get
-- the stamp the close trigger should have given them.
UPDATE t_employee_ledger el
JOIN t_cashflow_closing c ON c.cashflow_id = el.pending_cashflow_id
   SET el.cashflow_date = c.cashflow_date,
       el.pending_cashflow_id = NULL
 WHERE c.closing_status = 'CLOSED'
   AND el.cashflow_date IS NULL;
SELECT ROW_COUNT() AS employee_ledger_rows_backfilled;

-- ---------- Checks ----------
SELECT account_head_name, COUNT(*) AS locations, SUM(is_system_type = 'Y') AS system_heads
FROM m_account_heads
WHERE account_head_name IN ('Salary Advance', 'Salary Advance Recovery', 'Salary Payout', 'Salary Recovery')
GROUP BY account_head_name;
SELECT ROUTINE_DEFINITION LIKE '%Salary Advance Recovery%' AS generate_cashflow_updated
FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = 'generate_cashflow';
SELECT TRIGGER_NAME, ACTION_ORDER, ACTION_STATEMENT LIKE '%Salary Advance%' OR ACTION_STATEMENT LIKE '%t_employee_ledger%' AS updated
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME IN ('trg_cashflow_txn_account_head_insert', 'trg_cashflow_txn_account_head_update',
                       'trg_location_seed_data', 'after_cashflow_close');
