-- ============================================================
-- GL Delete Triggers — Source Transaction Deletion
-- Generated: 2026-05-02
--
-- When a source transaction row is deleted:
--   • UNPROCESSED / ERROR events are deleted directly —
--     nothing was ever journaled, so nothing to reverse.
--   • If PROCESSED events exist, a DELETE event is raised so
--     the engine can reverse the posted vouchers.
--
-- location_code / fy_id / event_date are read from the
-- existing gl_accounting_events row to avoid re-joining the
-- source table (cleaner, works even for soft-deleted rows).
--
-- Covers: t_credits, t_cashsales, t_day_bill, t_bank_transaction
-- ============================================================

DROP TRIGGER IF EXISTS trg_credits_gl_delete;
DROP TRIGGER IF EXISTS trg_cashsales_gl_delete;
DROP TRIGGER IF EXISTS trg_day_bill_gl_delete;
DROP TRIGGER IF EXISTS trg_bank_txn_gl_delete;

DELIMITER $$

-- ── t_credits : DELETE ────────────────────────────────────────────────────────

CREATE TRIGGER trg_credits_gl_delete
AFTER DELETE ON t_credits
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'CREDIT_SALE' AND source_id = OLD.tcredit_id
    ORDER BY event_id DESC
    LIMIT 1;

    IF v_location_code IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type  = 'CREDIT_SALE'
          AND  source_id    = OLD.tcredit_id
          AND  event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type  = 'CREDIT_SALE'
          AND  source_id    = OLD.tcredit_id
          AND  event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CREDIT_SALE', OLD.tcredit_id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_cashsales : DELETE ──────────────────────────────────────────────────────

CREATE TRIGGER trg_cashsales_gl_delete
AFTER DELETE ON t_cashsales
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'CASH_SALE' AND source_id = OLD.cashsales_id
    ORDER BY event_id DESC
    LIMIT 1;

    IF v_location_code IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type  = 'CASH_SALE'
          AND  source_id    = OLD.cashsales_id
          AND  event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type  = 'CASH_SALE'
          AND  source_id    = OLD.cashsales_id
          AND  event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CASH_SALE', OLD.cashsales_id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_day_bill : DELETE ───────────────────────────────────────────────────────

CREATE TRIGGER trg_day_bill_gl_delete
AFTER DELETE ON t_day_bill
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'DAY_BILL' AND source_id = OLD.day_bill_id
    ORDER BY event_id DESC
    LIMIT 1;

    IF v_location_code IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type  = 'DAY_BILL'
          AND  source_id    = OLD.day_bill_id
          AND  event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type  = 'DAY_BILL'
          AND  source_id    = OLD.day_bill_id
          AND  event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'DAY_BILL', OLD.day_bill_id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_bank_transaction : DELETE ───────────────────────────────────────────────

CREATE TRIGGER trg_bank_txn_gl_delete
AFTER DELETE ON t_bank_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'BANK_TXN' AND source_id = OLD.t_bank_id
    ORDER BY event_id DESC
    LIMIT 1;

    IF v_location_code IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type  = 'BANK_TXN'
          AND  source_id    = OLD.t_bank_id
          AND  event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type  = 'BANK_TXN'
          AND  source_id    = OLD.t_bank_id
          AND  event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'BANK_TXN', OLD.t_bank_id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

DELIMITER ;

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SHOW TRIGGERS WHERE `Table` IN ('t_credits', 't_cashsales', 't_day_bill', 't_bank_transaction');
