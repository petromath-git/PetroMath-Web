-- ============================================================
-- GL Accounting Event Triggers
-- Generated: 2026-04-30
--
-- Raises gl_accounting_events rows automatically on writes to:
--   t_credits    → CREDIT_SALE events  (source_id = tcredit_id)
--   t_cashsales  → CASH_SALE events    (source_id = cashsales_id)
--   t_day_bill   → DAY_BILL events     (source_id = day_bill_id)
--
-- UPDATE logic (shared by all three tables):
--   • PROCESSED event exists  → INSERT new UPDATE event (engine will reverse + redo)
--   • UNPROCESSED event exists → flip event_type to UPDATE in-place (picks up latest data when run)
--   • No event exists         → INSERT CREATE event (edge case: accounting never run)
--
-- DELETE logic (credits / cashsales only — for shift reopen):
--   • PROCESSED event exists  → INSERT DELETE event (engine reverses)
--   • UNPROCESSED event exists → DELETE the pending event (never journalised, nothing to reverse)
-- ============================================================

DROP TRIGGER IF EXISTS trg_credit_sale_gl_insert;
DROP TRIGGER IF EXISTS trg_credit_sale_gl_update;
DROP TRIGGER IF EXISTS trg_credit_sale_gl_delete;
DROP TRIGGER IF EXISTS trg_cash_sale_gl_insert;
DROP TRIGGER IF EXISTS trg_cash_sale_gl_update;
DROP TRIGGER IF EXISTS trg_cash_sale_gl_delete;
DROP TRIGGER IF EXISTS trg_day_bill_gl_insert;
DROP TRIGGER IF EXISTS trg_day_bill_gl_update;

DELIMITER $$

-- ── t_credits : INSERT ────────────────────────────────────────────────────────

CREATE TRIGGER trg_credit_sale_gl_insert
AFTER INSERT ON t_credits
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);
    DECLARE v_closing_date  DATE;
    DECLARE v_fy_id         INT;

    SELECT c.location_code, DATE(c.closing_date)
    INTO   v_location_code, v_closing_date
    FROM   t_closing c
    WHERE  c.closing_id = NEW.closing_id;

    SELECT fy.fy_id INTO v_fy_id
    FROM   gl_financial_years fy
    WHERE  fy.location_code = v_location_code
      AND  v_closing_date BETWEEN fy.start_date AND fy.end_date
    LIMIT 1;

    IF v_fy_id IS NOT NULL THEN
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        VALUES
            (v_location_code, v_fy_id, 'CREDIT_SALE', NEW.tcredit_id, 'CREATE', v_closing_date, 'UNPROCESSED', 'TRIGGER');
    END IF;
END$$

-- ── t_credits : UPDATE ────────────────────────────────────────────────────────

CREATE TRIGGER trg_credit_sale_gl_update
AFTER UPDATE ON t_credits
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_closing_date    DATE;
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    SELECT c.location_code, DATE(c.closing_date)
    INTO   v_location_code, v_closing_date
    FROM   t_closing c
    WHERE  c.closing_id = NEW.closing_id;

    SELECT fy.fy_id INTO v_fy_id
    FROM   gl_financial_years fy
    WHERE  fy.location_code = v_location_code
      AND  v_closing_date BETWEEN fy.start_date AND fy.end_date
    LIMIT 1;

    IF v_fy_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'CREDIT_SALE' AND source_id = NEW.tcredit_id AND event_status = 'PROCESSED';

        SELECT COUNT(*) INTO v_pending_count
        FROM   gl_accounting_events
        WHERE  source_type = 'CREDIT_SALE' AND source_id = NEW.tcredit_id AND event_status = 'UNPROCESSED';

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CREDIT_SALE', NEW.tcredit_id, 'UPDATE', v_closing_date, 'UNPROCESSED', 'TRIGGER');
        ELSEIF v_pending_count > 0 THEN
            UPDATE gl_accounting_events
            SET    event_type = 'UPDATE'
            WHERE  source_type = 'CREDIT_SALE' AND source_id = NEW.tcredit_id AND event_status = 'UNPROCESSED';
        ELSE
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CREDIT_SALE', NEW.tcredit_id, 'CREATE', v_closing_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_credits : DELETE ────────────────────────────────────────────────────────

CREATE TRIGGER trg_credit_sale_gl_delete
AFTER DELETE ON t_credits
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_closing_date    DATE;
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT c.location_code, DATE(c.closing_date)
    INTO   v_location_code, v_closing_date
    FROM   t_closing c
    WHERE  c.closing_id = OLD.closing_id;

    SELECT fy.fy_id INTO v_fy_id
    FROM   gl_financial_years fy
    WHERE  fy.location_code = v_location_code
      AND  v_closing_date BETWEEN fy.start_date AND fy.end_date
    LIMIT 1;

    IF v_fy_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'CREDIT_SALE' AND source_id = OLD.tcredit_id AND event_status = 'PROCESSED';

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CREDIT_SALE', OLD.tcredit_id, 'DELETE', v_closing_date, 'UNPROCESSED', 'TRIGGER');
        ELSE
            DELETE FROM gl_accounting_events
            WHERE  source_type = 'CREDIT_SALE' AND source_id = OLD.tcredit_id AND event_status = 'UNPROCESSED';
        END IF;
    END IF;
END$$

-- ── t_cashsales : INSERT ──────────────────────────────────────────────────────

CREATE TRIGGER trg_cash_sale_gl_insert
AFTER INSERT ON t_cashsales
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);
    DECLARE v_closing_date  DATE;
    DECLARE v_fy_id         INT;

    SELECT c.location_code, DATE(c.closing_date)
    INTO   v_location_code, v_closing_date
    FROM   t_closing c
    WHERE  c.closing_id = NEW.closing_id;

    SELECT fy.fy_id INTO v_fy_id
    FROM   gl_financial_years fy
    WHERE  fy.location_code = v_location_code
      AND  v_closing_date BETWEEN fy.start_date AND fy.end_date
    LIMIT 1;

    IF v_fy_id IS NOT NULL THEN
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        VALUES
            (v_location_code, v_fy_id, 'CASH_SALE', NEW.cashsales_id, 'CREATE', v_closing_date, 'UNPROCESSED', 'TRIGGER');
    END IF;
END$$

-- ── t_cashsales : UPDATE ──────────────────────────────────────────────────────

CREATE TRIGGER trg_cash_sale_gl_update
AFTER UPDATE ON t_cashsales
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_closing_date    DATE;
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    SELECT c.location_code, DATE(c.closing_date)
    INTO   v_location_code, v_closing_date
    FROM   t_closing c
    WHERE  c.closing_id = NEW.closing_id;

    SELECT fy.fy_id INTO v_fy_id
    FROM   gl_financial_years fy
    WHERE  fy.location_code = v_location_code
      AND  v_closing_date BETWEEN fy.start_date AND fy.end_date
    LIMIT 1;

    IF v_fy_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'CASH_SALE' AND source_id = NEW.cashsales_id AND event_status = 'PROCESSED';

        SELECT COUNT(*) INTO v_pending_count
        FROM   gl_accounting_events
        WHERE  source_type = 'CASH_SALE' AND source_id = NEW.cashsales_id AND event_status = 'UNPROCESSED';

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CASH_SALE', NEW.cashsales_id, 'UPDATE', v_closing_date, 'UNPROCESSED', 'TRIGGER');
        ELSEIF v_pending_count > 0 THEN
            UPDATE gl_accounting_events
            SET    event_type = 'UPDATE'
            WHERE  source_type = 'CASH_SALE' AND source_id = NEW.cashsales_id AND event_status = 'UNPROCESSED';
        ELSE
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CASH_SALE', NEW.cashsales_id, 'CREATE', v_closing_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_cashsales : DELETE ──────────────────────────────────────────────────────

CREATE TRIGGER trg_cash_sale_gl_delete
AFTER DELETE ON t_cashsales
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_closing_date    DATE;
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT c.location_code, DATE(c.closing_date)
    INTO   v_location_code, v_closing_date
    FROM   t_closing c
    WHERE  c.closing_id = OLD.closing_id;

    SELECT fy.fy_id INTO v_fy_id
    FROM   gl_financial_years fy
    WHERE  fy.location_code = v_location_code
      AND  v_closing_date BETWEEN fy.start_date AND fy.end_date
    LIMIT 1;

    IF v_fy_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'CASH_SALE' AND source_id = OLD.cashsales_id AND event_status = 'PROCESSED';

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CASH_SALE', OLD.cashsales_id, 'DELETE', v_closing_date, 'UNPROCESSED', 'TRIGGER');
        ELSE
            DELETE FROM gl_accounting_events
            WHERE  source_type = 'CASH_SALE' AND source_id = OLD.cashsales_id AND event_status = 'UNPROCESSED';
        END IF;
    END IF;
END$$

-- ── t_day_bill : INSERT ───────────────────────────────────────────────────────

CREATE TRIGGER trg_day_bill_gl_insert
AFTER INSERT ON t_day_bill
FOR EACH ROW
BEGIN
    DECLARE v_fy_id INT;

    SELECT fy.fy_id INTO v_fy_id
    FROM   gl_financial_years fy
    WHERE  fy.location_code = NEW.location_code
      AND  NEW.bill_date BETWEEN fy.start_date AND fy.end_date
    LIMIT 1;

    IF v_fy_id IS NOT NULL THEN
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        VALUES
            (NEW.location_code, v_fy_id, 'DAY_BILL', NEW.day_bill_id, 'CREATE', NEW.bill_date, 'UNPROCESSED', 'TRIGGER');
    END IF;
END$$

-- ── t_day_bill : UPDATE ───────────────────────────────────────────────────────

CREATE TRIGGER trg_day_bill_gl_update
AFTER UPDATE ON t_day_bill
FOR EACH ROW
BEGIN
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    SELECT fy.fy_id INTO v_fy_id
    FROM   gl_financial_years fy
    WHERE  fy.location_code = NEW.location_code
      AND  NEW.bill_date BETWEEN fy.start_date AND fy.end_date
    LIMIT 1;

    IF v_fy_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'DAY_BILL' AND source_id = NEW.day_bill_id AND event_status = 'PROCESSED';

        SELECT COUNT(*) INTO v_pending_count
        FROM   gl_accounting_events
        WHERE  source_type = 'DAY_BILL' AND source_id = NEW.day_bill_id AND event_status = 'UNPROCESSED';

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (NEW.location_code, v_fy_id, 'DAY_BILL', NEW.day_bill_id, 'UPDATE', NEW.bill_date, 'UNPROCESSED', 'TRIGGER');
        ELSEIF v_pending_count > 0 THEN
            UPDATE gl_accounting_events
            SET    event_type = 'UPDATE'
            WHERE  source_type = 'DAY_BILL' AND source_id = NEW.day_bill_id AND event_status = 'UNPROCESSED';
        ELSE
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (NEW.location_code, v_fy_id, 'DAY_BILL', NEW.day_bill_id, 'CREATE', NEW.bill_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

DELIMITER ;

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SHOW TRIGGERS WHERE `Table` IN ('t_credits', 't_cashsales', 't_day_bill');
