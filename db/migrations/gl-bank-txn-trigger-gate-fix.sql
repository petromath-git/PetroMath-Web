-- ============================================================
-- Fix: BANK_TXN triggers were not gated by is_gl_accounting_enabled()
-- Generated: 2026-08-16
--
-- Every other GL trigger (CREDIT_SALE, CASH_SALE, DAY_BILL, TANK_INVOICE,
-- LUBES_INVOICE, BOWSER_*, CASHFLOW_TXN, ADJUSTMENT) checks
-- is_gl_accounting_enabled(location_code) before queuing an event.
-- trg_bank_txn_gl_delete already had the check; trg_bank_txn_gl_insert,
-- trg_bank_txn_gl_update, trg_bank_txn_split_gl_insert, and
-- trg_bank_txn_split_gl_delete did not — found while scoping the SFS P&L
-- work (they'd been silently queuing BANK_TXN events for every location,
-- gate on or off, since the engine was first built). Nothing has been
-- posted from those events (all sat UNPROCESSED), so this is a
-- forward-looking consistency fix, not a data correction — existing
-- queued events are untouched and still valid, they just won't have kept
-- growing ungated once this is applied.
-- ============================================================

DROP TRIGGER IF EXISTS trg_bank_txn_gl_insert;
DROP TRIGGER IF EXISTS trg_bank_txn_gl_update;
DROP TRIGGER IF EXISTS trg_bank_txn_split_gl_insert;
DROP TRIGGER IF EXISTS trg_bank_txn_split_gl_delete;

DELIMITER $$

CREATE TRIGGER trg_bank_txn_gl_insert
AFTER INSERT ON t_bank_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);
    DECLARE v_fy_id         INT;

    SELECT mb.location_code
    INTO   v_location_code
    FROM   m_bank mb
    WHERE  mb.bank_id = NEW.bank_id;

    IF v_location_code IS NOT NULL AND is_gl_accounting_enabled(v_location_code) THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = v_location_code
          AND  NEW.trans_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'BANK_TXN', NEW.t_bank_id, 'CREATE', NEW.trans_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_bank_txn_gl_update
AFTER UPDATE ON t_bank_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;
    DECLARE v_cols_changed    TINYINT DEFAULT 0;

    IF NOT (NEW.external_source <=> OLD.external_source)
    OR NOT (NEW.external_id     <=> OLD.external_id)
    OR NOT (NEW.ledger_name     <=> OLD.ledger_name)
    OR NOT (NEW.is_split        <=> OLD.is_split)
    THEN
        SET v_cols_changed = 1;
    END IF;

    IF v_cols_changed = 1 THEN
        SELECT mb.location_code
        INTO   v_location_code
        FROM   m_bank mb
        WHERE  mb.bank_id = NEW.bank_id;

        IF v_location_code IS NOT NULL AND is_gl_accounting_enabled(v_location_code) THEN
            SELECT fy.fy_id INTO v_fy_id
            FROM   gl_financial_years fy
            WHERE  fy.location_code = v_location_code
              AND  NEW.trans_date BETWEEN fy.start_date AND fy.end_date
            LIMIT 1;

            IF v_fy_id IS NOT NULL THEN
                SELECT COUNT(*) INTO v_processed_count
                FROM   gl_accounting_events
                WHERE  source_type = 'BANK_TXN' AND source_id = NEW.t_bank_id AND event_status = 'PROCESSED';

                SELECT COUNT(*) INTO v_pending_count
                FROM   gl_accounting_events
                WHERE  source_type = 'BANK_TXN' AND source_id = NEW.t_bank_id AND event_status = 'UNPROCESSED';

                IF v_processed_count > 0 THEN
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (v_location_code, v_fy_id, 'BANK_TXN', NEW.t_bank_id, 'UPDATE', NEW.trans_date, 'UNPROCESSED', 'TRIGGER');
                ELSEIF v_pending_count > 0 THEN
                    UPDATE gl_accounting_events
                    SET    event_type = 'UPDATE'
                    WHERE  source_type = 'BANK_TXN' AND source_id = NEW.t_bank_id AND event_status = 'UNPROCESSED';
                ELSE
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (v_location_code, v_fy_id, 'BANK_TXN', NEW.t_bank_id, 'CREATE', NEW.trans_date, 'UNPROCESSED', 'TRIGGER');
                END IF;
            END IF;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_bank_txn_split_gl_insert
AFTER INSERT ON t_bank_transaction_splits
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_trans_date      DATE;
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    SELECT mb.location_code, tbt.trans_date
    INTO   v_location_code, v_trans_date
    FROM   t_bank_transaction tbt
    JOIN   m_bank mb ON mb.bank_id = tbt.bank_id
    WHERE  tbt.t_bank_id = NEW.t_bank_id;

    IF v_location_code IS NOT NULL AND is_gl_accounting_enabled(v_location_code) THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = v_location_code
          AND  v_trans_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_processed_count
            FROM   gl_accounting_events
            WHERE  source_type = 'BANK_TXN' AND source_id = NEW.t_bank_id AND event_status = 'PROCESSED';

            SELECT COUNT(*) INTO v_pending_count
            FROM   gl_accounting_events
            WHERE  source_type = 'BANK_TXN' AND source_id = NEW.t_bank_id AND event_status = 'UNPROCESSED';

            IF v_processed_count > 0 THEN
                INSERT INTO gl_accounting_events
                    (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                VALUES
                    (v_location_code, v_fy_id, 'BANK_TXN', NEW.t_bank_id, 'UPDATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
            ELSEIF v_pending_count > 0 THEN
                UPDATE gl_accounting_events
                SET    event_type = 'UPDATE'
                WHERE  source_type = 'BANK_TXN' AND source_id = NEW.t_bank_id AND event_status = 'UNPROCESSED';
            ELSE
                INSERT INTO gl_accounting_events
                    (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                VALUES
                    (v_location_code, v_fy_id, 'BANK_TXN', NEW.t_bank_id, 'CREATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
            END IF;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_bank_txn_split_gl_delete
AFTER DELETE ON t_bank_transaction_splits
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_trans_date      DATE;
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    SELECT mb.location_code, tbt.trans_date
    INTO   v_location_code, v_trans_date
    FROM   t_bank_transaction tbt
    JOIN   m_bank mb ON mb.bank_id = tbt.bank_id
    WHERE  tbt.t_bank_id = OLD.t_bank_id;

    IF v_location_code IS NOT NULL AND is_gl_accounting_enabled(v_location_code) THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = v_location_code
          AND  v_trans_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_processed_count
            FROM   gl_accounting_events
            WHERE  source_type = 'BANK_TXN' AND source_id = OLD.t_bank_id AND event_status = 'PROCESSED';

            SELECT COUNT(*) INTO v_pending_count
            FROM   gl_accounting_events
            WHERE  source_type = 'BANK_TXN' AND source_id = OLD.t_bank_id AND event_status = 'UNPROCESSED';

            IF v_processed_count > 0 THEN
                INSERT INTO gl_accounting_events
                    (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                VALUES
                    (v_location_code, v_fy_id, 'BANK_TXN', OLD.t_bank_id, 'UPDATE', v_trans_date, 'UNPROCESSED', 'TRIGGER');
            ELSEIF v_pending_count > 0 THEN
                UPDATE gl_accounting_events
                SET    event_type = 'UPDATE'
                WHERE  source_type = 'BANK_TXN' AND source_id = OLD.t_bank_id AND event_status = 'UNPROCESSED';
            END IF;
        END IF;
    END IF;
END$$

DELIMITER ;

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.TRIGGERS
WHERE trigger_schema = DATABASE()
  AND trigger_name IN ('trg_bank_txn_gl_insert', 'trg_bank_txn_gl_update',
                        'trg_bank_txn_gl_delete', 'trg_bank_txn_split_gl_insert',
                        'trg_bank_txn_split_gl_delete')
ORDER BY trigger_name;
