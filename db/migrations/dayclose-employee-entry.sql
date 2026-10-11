-- ============================================================
-- Day Close: salary lines create employee ledger entries
-- Generated: 2026-10-09   (run AFTER salary-heads-split.sql)
--
-- Employee ledger cash movements come only from Day Close. A Salary
-- Advance / Salary Payout / Salary Advance Recovery line now asks for the
-- employee and creates the t_employee_ledger entry (ADVANCE / PAYMENT /
-- ADVANCE_RECOVERY, dated on the Day Close); generate_cashflow then shows it
-- as the linked line. Same pattern as dayclose-cash-receipt-entry.sql.
--
-- 1. m_account_heads.employee_ledger_txn_type: the ledger type a Day Close
--    line on that head creates (NULL = not an employee line).
-- 2. t_employee_ledger.origin_cashflow_id: Day Close the entry was entered
--    from; deleted together with that Day Close.
-- 3. Fix: Cash Receipt heads seeded for locations created after
--    2026-10-04 (AMT, SHA, SAR) were missing requires_credit_customer_link.
-- 4. delete_cashflow also deletes employee entries entered from the Day
--    Close (history trigger logs them as DAY_CLOSE_DELETE:<cashflow_id>).
-- 5. trg_location_seed_data sets both flags for new locations.
--
-- Definitions 4-5 are the repo copies (dayclose-cash-receipt-entry.sql,
-- salary-heads-split.sql; identical logic to live) plus the changes above.
-- Plain ADD COLUMN/ADD INDEX (this server rejects IF NOT EXISTS there).
-- ============================================================

SET SESSION sql_mode = 'ALLOW_INVALID_DATES,NO_ENGINE_SUBSTITUTION';

ALTER TABLE m_account_heads
    ADD COLUMN employee_ledger_txn_type VARCHAR(30) NULL
        COMMENT 'ADVANCE / PAYMENT / ADVANCE_RECOVERY: a Day Close line on this head picks an employee and creates that t_employee_ledger entry';

UPDATE m_account_heads
   SET employee_ledger_txn_type = CASE account_head_name
           WHEN 'Salary Advance'          THEN 'ADVANCE'
           WHEN 'Salary Payout'           THEN 'PAYMENT'
           WHEN 'Salary Advance Recovery' THEN 'ADVANCE_RECOVERY' END
 WHERE account_head_name IN ('Salary Advance', 'Salary Payout', 'Salary Advance Recovery')
   AND is_system_type = 'Y';

UPDATE m_account_heads
   SET requires_credit_customer_link = 'Y'
 WHERE account_head_name = 'Cash Receipt'
   AND requires_credit_customer_link <> 'Y';

ALTER TABLE t_employee_ledger
    ADD COLUMN origin_cashflow_id INT NULL
        COMMENT 'Day Close (t_cashflow_closing.cashflow_id) this entry was entered from; deleted together with that Day Close',
    ADD INDEX idx_employee_ledger_origin_cashflow (origin_cashflow_id);

DROP PROCEDURE IF EXISTS delete_cashflow;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` PROCEDURE `delete_cashflow`(IN p_cashflow_id INT)
BEGIN
    DECLARE v_reconciled INT DEFAULT 0;

    -- Receipts entered from this Day Close go with it - unless one is
    -- already bank-reconciled, in which case nothing is changed.
    SELECT COUNT(*) INTO v_reconciled
      FROM t_receipts
     WHERE origin_cashflow_id = p_cashflow_id
       AND (recon_match_id IS NOT NULL OR COALESCE(manual_recon_flag, 0) = 1);

    IF v_reconciled > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot delete: a cash receipt entered from this Day Close is already bank-reconciled. Remove the reconciliation first.';
    END IF;

    SET SQL_SAFE_UPDATES = 0;

    DELETE FROM t_receipts WHERE origin_cashflow_id = p_cashflow_id;

    -- Employee ledger entries entered from this Day Close go with it too
    -- (before_employee_ledger_delete logs them to t_employee_ledger_history).
    SET @ledger_action_by = CONCAT('DAY_CLOSE_DELETE:', p_cashflow_id);
    DELETE FROM t_employee_ledger WHERE origin_cashflow_id = p_cashflow_id;

    UPDATE t_receipts          SET pending_cashflow_id = NULL,cashflow_date = NULL WHERE pending_cashflow_id = p_cashflow_id;
    UPDATE t_employee_ledger  SET pending_cashflow_id = NULL WHERE pending_cashflow_id = p_cashflow_id;

    DELETE FROM t_cashflow_closing      WHERE cashflow_id = p_cashflow_id;
    DELETE FROM t_cashflow_transaction  WHERE cashflow_id = p_cashflow_id;
    DELETE FROM t_cashflow_denomination WHERE cashflow_id = p_cashflow_id;

    UPDATE t_closing SET cashflow_id = NULL WHERE cashflow_id = p_cashflow_id;
END$$
DELIMITER ;

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

        -- Day Close lines that must carry a party: Cash Receipt -> customer
        -- (credit receipt), salary lines -> employee (employee ledger entry)
        UPDATE m_account_heads
           SET requires_credit_customer_link = 'Y'
         WHERE location_code = NEW.location_code AND account_head_name = 'Cash Receipt';
        UPDATE m_account_heads
           SET employee_ledger_txn_type = CASE account_head_name
                   WHEN 'Salary Advance'          THEN 'ADVANCE'
                   WHEN 'Salary Payout'           THEN 'PAYMENT'
                   WHEN 'Salary Advance Recovery' THEN 'ADVANCE_RECOVERY' END
         WHERE location_code = NEW.location_code
           AND account_head_name IN ('Salary Advance', 'Salary Payout', 'Salary Advance Recovery');

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

-- ---------- Checks ----------
SELECT account_head_name, employee_ledger_txn_type, COUNT(*) AS locations
FROM m_account_heads
WHERE employee_ledger_txn_type IS NOT NULL
GROUP BY account_head_name, employee_ledger_txn_type;
SELECT COUNT(*) AS cash_receipt_heads, SUM(requires_credit_customer_link = 'Y') AS with_customer_picker
FROM m_account_heads WHERE account_head_name = 'Cash Receipt';
SHOW COLUMNS FROM t_employee_ledger LIKE 'origin_cashflow_id';
SELECT ROUTINE_DEFINITION LIKE '%t_employee_ledger WHERE origin_cashflow_id%' AS delete_cashflow_updated
FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = 'delete_cashflow';
SELECT ACTION_STATEMENT LIKE '%employee_ledger_txn_type%' AS seed_trigger_updated
FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'trg_location_seed_data';
