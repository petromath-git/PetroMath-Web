-- Migration: Auto-create oil company supplier + SOA bank when a location is created
-- Extends trg_location_seed_data to INSERT into m_supplier and m_bank based on company_name.
-- The after_supplier_insert_ledger_rule trigger on m_supplier fires automatically,
-- so the ledger rule is created at no extra cost.
--
-- Oil company mapping (m_location.company_name → supplier_name / bank_name / template_id):
--   IOCL   → Indian Oil Corporation Limited   | IOCL-SOA  | template_id=2 (IOCL SAP Account Statement)
--   BPCL   → Bharat Petroleum Corporation Ltd | BPCL-SOA  | template_id=6 (BPCL SAP SOA Format)
--   HPCL   → Hindustan Petroleum Corp Ltd     | HPCL-SOA  | template_id=NULL (no template yet)
--   NAYARA → Nayara Energy Limited             | NAYARA-SOA| template_id=NULL (no template yet)

DROP TRIGGER IF EXISTS trg_location_seed_data;

DELIMITER $$

CREATE TRIGGER trg_location_seed_data
AFTER INSERT ON m_location
FOR EACH ROW
BEGIN
    DECLARE v_supplier_id   INT;
    DECLARE v_template_id   INT;
    DECLARE v_bank_name     VARCHAR(150);
    DECLARE v_supplier_name VARCHAR(200);

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

        -- Insert Lookup defaults
        INSERT INTO m_lookup
            (lookup_type, description, tag, start_date_active, end_date_active,
             attribute1, attribute2, attribute3, attribute4, attribute5,
             created_by, updated_by, updation_date, creation_date, location_code, tally_export)
        VALUES
            ('CashFlow', 'To Bank',           'OUT', '2020-01-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'N'),
            ('CashFlow', 'Cashier A/C (+)',   'IN',  '2020-01-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'Y'),
            ('CashFlow', 'Cashier A/C (-)',   'OUT', '2020-01-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'Y'),
            ('CashFlow', 'Cash Receipt',      'IN',  '2020-01-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'N'),
            ('CashFlow', 'Collection',        'IN',  '2020-01-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'N'),
            ('CashFlow', 'Balance B/F',       'IN',  '2020-01-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'N'),
            ('CashFlow', 'Expense',           'OUT', '2020-01-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'Y'),
            ('CashFlow', 'To WithDrawals',    'OUT', '2020-01-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'Y'),
            ('CashFlow', 'To Deposits',       'IN',  '2020-01-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'Y'),
            ('CashFlow', 'Shift Opening',     'OUT', '2020-01-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'N'),
            ('CashFlow', 'To Bank',           'OUT', '2024-06-01', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'N'),
            ('CashFlow', 'Shift Cash Return', 'IN',  '2025-04-08', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'N'),
            ('CashFlow', 'Salary Payout',     'OUT', '2024-04-01', NULL, '200', NULL, NULL, NULL, 'SALARY EXPENSES', 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'Y'),
            ('CashFlow', 'Salary Recovery',   'IN',  '2024-04-01', NULL, NULL, NULL, NULL, NULL, 'SALARY EXPENSES', 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'Y'),
            ('CashFlow', 'Discount',          'OUT', '2025-10-30', NULL, NULL, NULL, NULL, NULL, NULL, 'admin', 'admin', NOW(), NOW(), NEW.location_code, 'Y');

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
