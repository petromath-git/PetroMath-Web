-- ============================================================
-- trg_location_seed_data: stop seeding the '2T Oil' cashflow Account Head
-- Generated: 2026-09-25
--
-- Based on the trigger body currently live on prod (SHOW CREATE TRIGGER,
-- 2026-09-25), which is onboarding-seed-account-heads-not-lookup.sql.
-- Only change: '2T Oil' removed from the m_account_heads seed, the
-- m_ledger_rules display-sequence list and the gl_static_ledger_map list.
--
-- Why it's safe: generate_cashflow only auto-inserts a '2T Oil' cashflow
-- row for the hardcoded locations MC/MC2/MME/MUE, so a newly onboarded
-- location never uses this head. Existing locations are untouched.
-- ============================================================

DELIMITER $$

DROP TRIGGER IF EXISTS trg_location_seed_data$$

CREATE DEFINER=`petromath_prod`@`%` TRIGGER `trg_location_seed_data` AFTER INSERT ON `m_location` FOR EACH ROW BEGIN
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
            (NEW.location_code, 'Salary Recovery',    'CREDIT', 'Y', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Shift Opening',      'DEBIT',  'N', CURDATE(), 'admin', 'admin'),
            (NEW.location_code, 'Shift Cash Return',  'CREDIT', 'N', CURDATE(), 'admin', 'admin'),
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
            UNION ALL SELECT 'Salary Recovery', 100
            UNION ALL SELECT 'Shift Opening', 110
            UNION ALL SELECT 'Shift Cash Return', 120
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
               'Discount','Expense','Salary Payout','Salary Recovery','Shift Opening','Shift Cash Return',
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
