-- ============================================================================
-- Bank accounts always get a Ledger Name.
--
-- m_bank_allowed_ledgers_v takes a bank's label from m_bank.ledger_name. When it
-- is blank the label dropdowns (upload, Bank Statement, Oil Company Statement,
-- Bank Recon) still show the bank, but the browser turns the empty value into
-- the text 'null'. The line is saved with ledger_name='null', no bank id, and
-- accounting cannot post it.
--
-- Blank names come from Bank Master (optional field), onboarding, and the
-- m_location trigger that seeds the oil company account, so the default is set
-- on m_bank itself:
-- 1. fn_bank_default_ledger_name  "<bank name> (<nickname>)", or just the bank
--    name when the nickname is blank or the same. Last 4 of the account number
--    are added when another account at the location has that name.
-- 2. BEFORE INSERT / UPDATE triggers fill a blank name. A name someone typed is
--    never changed.
-- 3. Backfill of existing blank names.
--
-- Existing 'null' lines are repaired separately, row by row.
-- Safe to re-run.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_bank_ledger_name_default_ins;
DROP TRIGGER IF EXISTS trg_bank_ledger_name_default_upd;
DROP FUNCTION IF EXISTS fn_bank_default_ledger_name;

DELIMITER $$

CREATE FUNCTION fn_bank_default_ledger_name(
    p_location_code VARCHAR(50),
    p_bank_name     VARCHAR(250),
    p_nickname      VARCHAR(250),
    p_account_no    VARCHAR(250),
    p_bank_id       INT
) RETURNS VARCHAR(250)
READS SQL DATA
BEGIN
    DECLARE v_name VARCHAR(250);

    SET v_name = TRIM(p_bank_name);
    IF NULLIF(TRIM(p_nickname), '') IS NOT NULL AND UPPER(TRIM(p_nickname)) <> UPPER(v_name) THEN
        SET v_name = CONCAT(v_name, ' (', TRIM(p_nickname), ')');
    END IF;

    IF EXISTS (SELECT 1 FROM m_bank b
               WHERE b.location_code = p_location_code
                 AND b.bank_id <> IFNULL(p_bank_id, 0)
                 AND b.ledger_name = v_name) THEN
        SET v_name = CONCAT(v_name, ' ', RIGHT(TRIM(p_account_no), 4));
    END IF;

    RETURN v_name;
END$$

CREATE TRIGGER trg_bank_ledger_name_default_ins
BEFORE INSERT ON m_bank
FOR EACH ROW
BEGIN
    IF NULLIF(TRIM(NEW.ledger_name), '') IS NULL OR LOWER(TRIM(NEW.ledger_name)) = 'null' THEN
        SET NEW.ledger_name = fn_bank_default_ledger_name(NEW.location_code, NEW.bank_name, NEW.account_nickname, NEW.account_number, NULL);
    END IF;
END$$

CREATE TRIGGER trg_bank_ledger_name_default_upd
BEFORE UPDATE ON m_bank
FOR EACH ROW
BEGIN
    IF NULLIF(TRIM(NEW.ledger_name), '') IS NULL OR LOWER(TRIM(NEW.ledger_name)) = 'null' THEN
        SET NEW.ledger_name = fn_bank_default_ledger_name(NEW.location_code, NEW.bank_name, NEW.account_nickname, NEW.account_number, NEW.bank_id);
    END IF;
END$$

DELIMITER ;

-- The update trigger above fills the name. updated_by marks the rows.
UPDATE m_bank
SET updated_by = 'tkt465'
WHERE NULLIF(TRIM(ledger_name), '') IS NULL OR LOWER(TRIM(ledger_name)) = 'null'
ORDER BY bank_id;

SELECT location_code, bank_id, bank_name, account_nickname, ledger_name
FROM m_bank
WHERE updated_by = 'tkt465'
ORDER BY location_code, bank_id;
