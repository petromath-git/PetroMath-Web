-- Migration: block receipts and bank-statement lines dated before go-live
--
-- A location's go-live date is m_location.start_date. Anything paid before it
-- is already inside the opening balances, so a receipt or bank line dated
-- earlier double-counts (PAC, 2026-10: 49 August receipts from a statement
-- upload that reached back before the 07-Sep go-live).
--
-- These triggers are the hard stop for every path (statement upload, manual
-- bank entry, oil-company statement, reclassify/split, credit receipts screen,
-- shift-closing collections). The transaction-upload preview also drops
-- pre-go-live lines up front so users see a friendly message instead.
--
-- Existing rows are untouched: UPDATE only checks when the date (or location)
-- actually changes, so reconciliation/ledger updates on old rows still work.
-- If a location's go-live date is wrong, fix m_location.start_date.

DROP FUNCTION IF EXISTS get_location_golive_date;

DELIMITER $$

CREATE FUNCTION get_location_golive_date(p_location_code VARCHAR(50))
RETURNS DATE
READS SQL DATA
BEGIN
    DECLARE v_golive DATE;

    SELECT MIN(DATE(start_date)) INTO v_golive
    FROM   m_location
    WHERE  location_code = p_location_code
      AND  start_date > '1971-01-01';   -- ignore unset/zero dates

    RETURN v_golive;
END$$

DELIMITER ;


-- ── t_receipts ─────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_receipts_golive_insert;
DROP TRIGGER IF EXISTS trg_receipts_golive_update;

DELIMITER $$

CREATE TRIGGER trg_receipts_golive_insert
BEFORE INSERT ON t_receipts
FOR EACH ROW
BEGIN
    DECLARE v_golive DATE;
    DECLARE v_msg    VARCHAR(255);

    SET v_golive = get_location_golive_date(NEW.location_code);

    IF v_golive IS NOT NULL AND NEW.receipt_date < v_golive THEN
        SET v_msg = CONCAT('Receipt date ', DATE_FORMAT(NEW.receipt_date, '%d-%b-%Y'),
                           ' is before this location''s PetroMath go-live date (',
                           DATE_FORMAT(v_golive, '%d-%b-%Y'),
                           '). Payments before go-live belong in the opening balance.');
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
END$$

CREATE TRIGGER trg_receipts_golive_update
BEFORE UPDATE ON t_receipts
FOR EACH ROW
BEGIN
    DECLARE v_golive DATE;
    DECLARE v_msg    VARCHAR(255);

    IF NOT (NEW.receipt_date <=> OLD.receipt_date)
    OR NOT (NEW.location_code <=> OLD.location_code) THEN
        SET v_golive = get_location_golive_date(NEW.location_code);

        IF v_golive IS NOT NULL AND NEW.receipt_date < v_golive THEN
            SET v_msg = CONCAT('Receipt date ', DATE_FORMAT(NEW.receipt_date, '%d-%b-%Y'),
                               ' is before this location''s PetroMath go-live date (',
                               DATE_FORMAT(v_golive, '%d-%b-%Y'), ').');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;
END$$

DELIMITER ;


-- ── t_bank_transaction (location comes from m_bank) ────────────────────────

DROP TRIGGER IF EXISTS trg_bank_txn_golive_insert;
DROP TRIGGER IF EXISTS trg_bank_txn_golive_update;

DELIMITER $$

CREATE TRIGGER trg_bank_txn_golive_insert
BEFORE INSERT ON t_bank_transaction
FOR EACH ROW
BEGIN
    DECLARE v_golive DATE;
    DECLARE v_msg    VARCHAR(255);

    SELECT get_location_golive_date(b.location_code) INTO v_golive
    FROM   m_bank b
    WHERE  b.bank_id = NEW.bank_id;

    IF v_golive IS NOT NULL AND NEW.trans_date < v_golive THEN
        SET v_msg = CONCAT('Bank transaction dated ', DATE_FORMAT(NEW.trans_date, '%d-%b-%Y'),
                           ' is before this location''s PetroMath go-live date (',
                           DATE_FORMAT(v_golive, '%d-%b-%Y'), ').');
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
END$$

CREATE TRIGGER trg_bank_txn_golive_update
BEFORE UPDATE ON t_bank_transaction
FOR EACH ROW
BEGIN
    DECLARE v_golive DATE;
    DECLARE v_msg    VARCHAR(255);

    IF NOT (NEW.trans_date <=> OLD.trans_date)
    OR NOT (NEW.bank_id <=> OLD.bank_id) THEN
        SELECT get_location_golive_date(b.location_code) INTO v_golive
        FROM   m_bank b
        WHERE  b.bank_id = NEW.bank_id;

        IF v_golive IS NOT NULL AND NEW.trans_date < v_golive THEN
            SET v_msg = CONCAT('Bank transaction dated ', DATE_FORMAT(NEW.trans_date, '%d-%b-%Y'),
                               ' is before this location''s PetroMath go-live date (',
                               DATE_FORMAT(v_golive, '%d-%b-%Y'), ').');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;
END$$

DELIMITER ;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- Go-live date per location (check these are right before relying on the guard)
SELECT location_code, get_location_golive_date(location_code) AS golive
FROM   m_location
GROUP  BY location_code
ORDER  BY golive;

SHOW TRIGGERS WHERE `Trigger` LIKE '%golive%';
