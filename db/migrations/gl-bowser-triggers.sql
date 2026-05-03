-- ============================================================
-- GL Bowser Sale Event Triggers
-- Generated: 2026-05-02
--
-- Raises gl_accounting_events rows automatically on writes to:
--   t_bowser_credits       → BOWSER_CREDIT_SALE events  (source_id = credit_id)
--   t_bowser_cashsales     → BOWSER_CASH_SALE events    (source_id = cashsale_id)
--   t_bowser_digital_sales → BOWSER_DIGITAL_SALE events (source_id = digital_id)
--
-- Location / date resolved from t_bowser_closing (joined via bowser_closing_id).
-- DELETE triggers read location/fy/date from existing gl_accounting_events rows.
--
-- Bowser closing gate: the accounting engine skips BOWSER_* events for dates
-- where t_bowser_closing.status = 'DRAFT' — same pattern as shift closing gate.
-- ============================================================

DROP TRIGGER IF EXISTS trg_bowser_credit_gl_insert;
DROP TRIGGER IF EXISTS trg_bowser_credit_gl_update;
DROP TRIGGER IF EXISTS trg_bowser_credit_gl_delete;
DROP TRIGGER IF EXISTS trg_bowser_cash_gl_insert;
DROP TRIGGER IF EXISTS trg_bowser_cash_gl_update;
DROP TRIGGER IF EXISTS trg_bowser_cash_gl_delete;
DROP TRIGGER IF EXISTS trg_bowser_digital_gl_insert;
DROP TRIGGER IF EXISTS trg_bowser_digital_gl_update;
DROP TRIGGER IF EXISTS trg_bowser_digital_gl_delete;

DELIMITER $$

-- ── t_bowser_credits : INSERT ─────────────────────────────────────────────────

CREATE TRIGGER trg_bowser_credit_gl_insert
AFTER INSERT ON t_bowser_credits
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);
    DECLARE v_trans_date    DATE;
    DECLARE v_fy_id         INT;

    SELECT tbc.location_code, tbc.closing_date
    INTO   v_location_code, v_trans_date
    FROM   t_bowser_closing tbc
    WHERE  tbc.bowser_closing_id = NEW.bowser_closing_id;

    IF v_location_code IS NOT NULL THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = v_location_code
          AND  v_trans_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'BOWSER_CREDIT_SALE', NEW.credit_id, 'CREATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_bowser_credits : UPDATE ─────────────────────────────────────────────────
-- Fires when any financially relevant column changes.

CREATE TRIGGER trg_bowser_credit_gl_update
AFTER UPDATE ON t_bowser_credits
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_trans_date      DATE;
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    IF NOT (NEW.amount       <=> OLD.amount)
    OR NOT (NEW.product_id   <=> OLD.product_id)
    OR NOT (NEW.creditlist_id <=> OLD.creditlist_id)
    OR NOT (NEW.quantity     <=> OLD.quantity)
    OR NOT (NEW.rate         <=> OLD.rate)
    THEN
        SELECT tbc.location_code, tbc.closing_date
        INTO   v_location_code, v_trans_date
        FROM   t_bowser_closing tbc
        WHERE  tbc.bowser_closing_id = NEW.bowser_closing_id;

        IF v_location_code IS NOT NULL THEN
            SELECT fy.fy_id INTO v_fy_id
            FROM   gl_financial_years fy
            WHERE  fy.location_code = v_location_code
              AND  v_trans_date BETWEEN fy.start_date AND fy.end_date
            LIMIT 1;

            IF v_fy_id IS NOT NULL THEN
                SELECT COUNT(*) INTO v_processed_count
                FROM   gl_accounting_events
                WHERE  source_type = 'BOWSER_CREDIT_SALE' AND source_id = NEW.credit_id AND event_status = 'PROCESSED';

                SELECT COUNT(*) INTO v_pending_count
                FROM   gl_accounting_events
                WHERE  source_type = 'BOWSER_CREDIT_SALE' AND source_id = NEW.credit_id AND event_status = 'UNPROCESSED';

                IF v_processed_count > 0 THEN
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (v_location_code, v_fy_id, 'BOWSER_CREDIT_SALE', NEW.credit_id, 'UPDATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
                ELSEIF v_pending_count > 0 THEN
                    UPDATE gl_accounting_events
                    SET    event_type = 'UPDATE'
                    WHERE  source_type = 'BOWSER_CREDIT_SALE' AND source_id = NEW.credit_id AND event_status = 'UNPROCESSED';
                ELSE
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (v_location_code, v_fy_id, 'BOWSER_CREDIT_SALE', NEW.credit_id, 'CREATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
                END IF;
            END IF;
        END IF;
    END IF;
END$$

-- ── t_bowser_credits : DELETE ─────────────────────────────────────────────────

CREATE TRIGGER trg_bowser_credit_gl_delete
AFTER DELETE ON t_bowser_credits
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'BOWSER_CREDIT_SALE' AND source_id = OLD.credit_id
    ORDER BY event_id DESC LIMIT 1;

    IF v_location_code IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'BOWSER_CREDIT_SALE' AND source_id = OLD.credit_id AND event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type = 'BOWSER_CREDIT_SALE' AND source_id = OLD.credit_id AND event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'BOWSER_CREDIT_SALE', OLD.credit_id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_bowser_cashsales : INSERT ───────────────────────────────────────────────

CREATE TRIGGER trg_bowser_cash_gl_insert
AFTER INSERT ON t_bowser_cashsales
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);
    DECLARE v_trans_date    DATE;
    DECLARE v_fy_id         INT;

    SELECT tbc.location_code, tbc.closing_date
    INTO   v_location_code, v_trans_date
    FROM   t_bowser_closing tbc
    WHERE  tbc.bowser_closing_id = NEW.bowser_closing_id;

    IF v_location_code IS NOT NULL THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = v_location_code
          AND  v_trans_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'BOWSER_CASH_SALE', NEW.cashsale_id, 'CREATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_bowser_cashsales : UPDATE ───────────────────────────────────────────────

CREATE TRIGGER trg_bowser_cash_gl_update
AFTER UPDATE ON t_bowser_cashsales
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_trans_date      DATE;
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    IF NOT (NEW.amount     <=> OLD.amount)
    OR NOT (NEW.product_id <=> OLD.product_id)
    THEN
        SELECT tbc.location_code, tbc.closing_date
        INTO   v_location_code, v_trans_date
        FROM   t_bowser_closing tbc
        WHERE  tbc.bowser_closing_id = NEW.bowser_closing_id;

        IF v_location_code IS NOT NULL THEN
            SELECT fy.fy_id INTO v_fy_id
            FROM   gl_financial_years fy
            WHERE  fy.location_code = v_location_code
              AND  v_trans_date BETWEEN fy.start_date AND fy.end_date
            LIMIT 1;

            IF v_fy_id IS NOT NULL THEN
                SELECT COUNT(*) INTO v_processed_count
                FROM   gl_accounting_events
                WHERE  source_type = 'BOWSER_CASH_SALE' AND source_id = NEW.cashsale_id AND event_status = 'PROCESSED';

                SELECT COUNT(*) INTO v_pending_count
                FROM   gl_accounting_events
                WHERE  source_type = 'BOWSER_CASH_SALE' AND source_id = NEW.cashsale_id AND event_status = 'UNPROCESSED';

                IF v_processed_count > 0 THEN
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (v_location_code, v_fy_id, 'BOWSER_CASH_SALE', NEW.cashsale_id, 'UPDATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
                ELSEIF v_pending_count > 0 THEN
                    UPDATE gl_accounting_events
                    SET    event_type = 'UPDATE'
                    WHERE  source_type = 'BOWSER_CASH_SALE' AND source_id = NEW.cashsale_id AND event_status = 'UNPROCESSED';
                ELSE
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (v_location_code, v_fy_id, 'BOWSER_CASH_SALE', NEW.cashsale_id, 'CREATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
                END IF;
            END IF;
        END IF;
    END IF;
END$$

-- ── t_bowser_cashsales : DELETE ───────────────────────────────────────────────

CREATE TRIGGER trg_bowser_cash_gl_delete
AFTER DELETE ON t_bowser_cashsales
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'BOWSER_CASH_SALE' AND source_id = OLD.cashsale_id
    ORDER BY event_id DESC LIMIT 1;

    IF v_location_code IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'BOWSER_CASH_SALE' AND source_id = OLD.cashsale_id AND event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type = 'BOWSER_CASH_SALE' AND source_id = OLD.cashsale_id AND event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'BOWSER_CASH_SALE', OLD.cashsale_id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_bowser_digital_sales : INSERT ──────────────────────────────────────────

CREATE TRIGGER trg_bowser_digital_gl_insert
AFTER INSERT ON t_bowser_digital_sales
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);
    DECLARE v_trans_date    DATE;
    DECLARE v_fy_id         INT;

    SELECT tbc.location_code, tbc.closing_date
    INTO   v_location_code, v_trans_date
    FROM   t_bowser_closing tbc
    WHERE  tbc.bowser_closing_id = NEW.bowser_closing_id;

    IF v_location_code IS NOT NULL THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = v_location_code
          AND  v_trans_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'BOWSER_DIGITAL_SALE', NEW.digital_id, 'CREATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_bowser_digital_sales : UPDATE ──────────────────────────────────────────

CREATE TRIGGER trg_bowser_digital_gl_update
AFTER UPDATE ON t_bowser_digital_sales
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_trans_date      DATE;
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    IF NOT (NEW.amount            <=> OLD.amount)
    OR NOT (NEW.digital_vendor_id <=> OLD.digital_vendor_id)
    THEN
        SELECT tbc.location_code, tbc.closing_date
        INTO   v_location_code, v_trans_date
        FROM   t_bowser_closing tbc
        WHERE  tbc.bowser_closing_id = NEW.bowser_closing_id;

        IF v_location_code IS NOT NULL THEN
            SELECT fy.fy_id INTO v_fy_id
            FROM   gl_financial_years fy
            WHERE  fy.location_code = v_location_code
              AND  v_trans_date BETWEEN fy.start_date AND fy.end_date
            LIMIT 1;

            IF v_fy_id IS NOT NULL THEN
                SELECT COUNT(*) INTO v_processed_count
                FROM   gl_accounting_events
                WHERE  source_type = 'BOWSER_DIGITAL_SALE' AND source_id = NEW.digital_id AND event_status = 'PROCESSED';

                SELECT COUNT(*) INTO v_pending_count
                FROM   gl_accounting_events
                WHERE  source_type = 'BOWSER_DIGITAL_SALE' AND source_id = NEW.digital_id AND event_status = 'UNPROCESSED';

                IF v_processed_count > 0 THEN
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (v_location_code, v_fy_id, 'BOWSER_DIGITAL_SALE', NEW.digital_id, 'UPDATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
                ELSEIF v_pending_count > 0 THEN
                    UPDATE gl_accounting_events
                    SET    event_type = 'UPDATE'
                    WHERE  source_type = 'BOWSER_DIGITAL_SALE' AND source_id = NEW.digital_id AND event_status = 'UNPROCESSED';
                ELSE
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (v_location_code, v_fy_id, 'BOWSER_DIGITAL_SALE', NEW.digital_id, 'CREATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
                END IF;
            END IF;
        END IF;
    END IF;
END$$

-- ── t_bowser_digital_sales : DELETE ──────────────────────────────────────────

CREATE TRIGGER trg_bowser_digital_gl_delete
AFTER DELETE ON t_bowser_digital_sales
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'BOWSER_DIGITAL_SALE' AND source_id = OLD.digital_id
    ORDER BY event_id DESC LIMIT 1;

    IF v_location_code IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'BOWSER_DIGITAL_SALE' AND source_id = OLD.digital_id AND event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type = 'BOWSER_DIGITAL_SALE' AND source_id = OLD.digital_id AND event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'BOWSER_DIGITAL_SALE', OLD.digital_id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

DELIMITER ;

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SHOW TRIGGERS WHERE `Table` IN ('t_bowser_credits', 't_bowser_cashsales', 't_bowser_digital_sales');
