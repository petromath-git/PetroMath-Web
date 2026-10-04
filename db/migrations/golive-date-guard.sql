-- Migration: block receipts, bank-statement lines and adjustments dated before go-live
--
-- Go-live = the date of the location's first shift (earliest t_closing row).
-- m_location.start_date is often set earlier than real use (record created at
-- onboarding), so it is only a fallback for a location with no shift yet.
--
-- Anything paid before go-live is already inside the opening balances, so a
-- receipt, bank line or adjustment dated earlier double-counts (PAC, 2026-10:
-- 49 August receipts from a statement upload that reached back before the
-- 07-Sep first shift). Opening Balance Entry adjustments (type 201) are exempt —
-- they are normally dated the day before go-live.
--
-- These triggers are the hard stop for every path (statement upload, manual
-- bank entry, oil-company statement, reclassify/split, credit receipts screen,
-- shift-closing collections, adjustments). The statement-upload preview and
-- the adjustment form also check up front so users see a friendly message.
--
-- Existing rows are untouched: UPDATE only checks when the date (or location /
-- type) actually changes, so reconciliation/ledger updates on old rows still work.


-- ── Index for the first-shift lookup ───────────────────────────────────────

SET @idx_exists = (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 't_closing'
      AND index_name = 'idx_t_closing_location_date'
);
SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE t_closing ADD INDEX idx_t_closing_location_date (location_code, closing_date)',
    'SELECT ''idx_t_closing_location_date already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ── Go-live lookup ─────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_location_golive_date;

DELIMITER $$

CREATE FUNCTION get_location_golive_date(p_location_code VARCHAR(50))
RETURNS DATE
READS SQL DATA
BEGIN
    DECLARE v_golive DATE;

    SELECT DATE(MIN(closing_date)) INTO v_golive
    FROM   t_closing
    WHERE  location_code = p_location_code;

    IF v_golive IS NULL THEN
        SELECT MIN(DATE(start_date)) INTO v_golive
        FROM   m_location
        WHERE  location_code = p_location_code
          AND  start_date > '1971-01-01';   -- ignore unset/zero dates
    END IF;

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


-- ── t_adjustments (Opening Balance Entry, type 201, is exempt) ─────────────

DROP TRIGGER IF EXISTS trg_adjustments_golive_insert;
DROP TRIGGER IF EXISTS trg_adjustments_golive_update;

DELIMITER $$

CREATE TRIGGER trg_adjustments_golive_insert
BEFORE INSERT ON t_adjustments
FOR EACH ROW
BEGIN
    DECLARE v_golive DATE;
    DECLARE v_msg    VARCHAR(255);

    IF NOT (NEW.adjustment_type <=> '201') THEN
        SET v_golive = get_location_golive_date(NEW.location_code);

        IF v_golive IS NOT NULL AND NEW.adjustment_date < v_golive THEN
            SET v_msg = CONCAT('Adjustment date ', DATE_FORMAT(NEW.adjustment_date, '%d-%b-%Y'),
                               ' is before this location''s PetroMath go-live date (',
                               DATE_FORMAT(v_golive, '%d-%b-%Y'),
                               '). Use an Opening Balance Entry for balances before go-live.');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_adjustments_golive_update
BEFORE UPDATE ON t_adjustments
FOR EACH ROW
BEGIN
    DECLARE v_golive DATE;
    DECLARE v_msg    VARCHAR(255);

    IF NOT (NEW.adjustment_type <=> '201')
    AND (   NOT (NEW.adjustment_date <=> OLD.adjustment_date)
         OR NOT (NEW.location_code   <=> OLD.location_code)
         OR NOT (NEW.adjustment_type <=> OLD.adjustment_type)) THEN
        SET v_golive = get_location_golive_date(NEW.location_code);

        IF v_golive IS NOT NULL AND NEW.adjustment_date < v_golive THEN
            SET v_msg = CONCAT('Adjustment date ', DATE_FORMAT(NEW.adjustment_date, '%d-%b-%Y'),
                               ' is before this location''s PetroMath go-live date (',
                               DATE_FORMAT(v_golive, '%d-%b-%Y'), ').');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;
END$$

DELIMITER ;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- Go-live per location: first shift vs m_location.start_date (check these look right)
SELECT l.location_code,
       DATE(MIN(l.start_date))                     AS m_location_start,
       (SELECT DATE(MIN(c.closing_date)) FROM t_closing c
         WHERE c.location_code = l.location_code)  AS first_shift,
       get_location_golive_date(l.location_code)   AS golive_used
FROM   m_location l
GROUP  BY l.location_code
ORDER  BY golive_used;

SHOW TRIGGERS WHERE `Trigger` LIKE '%golive%';
