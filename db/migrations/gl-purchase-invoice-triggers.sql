-- ============================================================
-- GL Purchase Invoice Event Triggers
-- Generated: 2026-05-02
--
-- Raises gl_accounting_events rows automatically on writes to:
--   t_lubes_inv_hdr  → LUBES_INVOICE events  (source_id = lubes_hdr_id)
--   t_tank_invoice   → TANK_INVOICE events   (source_id = id)
--
-- Triggers are on HEADERS only.  Lines are read at process time.
--
-- LUBES_INVOICE draft gate:
--   The engine handler checks closing_status at process time.
--   If DRAFT  → marks PROCESSED with 0 vouchers (skip silently).
--   If CLOSED → journals created normally.
--   When status changes DRAFT→CLOSED the UPDATE trigger fires,
--   raising an UPDATE event that the engine picks up.
--
-- TANK_INVOICE:
--   No status column — events processed immediately on INSERT/UPDATE.
--   location_id column stores the location_code string.
-- ============================================================

DROP TRIGGER IF EXISTS trg_lubes_inv_gl_insert;
DROP TRIGGER IF EXISTS trg_lubes_inv_gl_update;
DROP TRIGGER IF EXISTS trg_lubes_inv_gl_delete;
DROP TRIGGER IF EXISTS trg_tank_inv_gl_insert;
DROP TRIGGER IF EXISTS trg_tank_inv_gl_update;
DROP TRIGGER IF EXISTS trg_tank_inv_gl_delete;

DELIMITER $$

-- ── t_lubes_inv_hdr : INSERT ──────────────────────────────────────────────────

CREATE TRIGGER trg_lubes_inv_gl_insert
AFTER INSERT ON t_lubes_inv_hdr
FOR EACH ROW
BEGIN
    DECLARE v_fy_id INT;

    SELECT fy.fy_id INTO v_fy_id
    FROM   gl_financial_years fy
    WHERE  fy.location_code = NEW.location_code
      AND  NEW.invoice_date BETWEEN fy.start_date AND fy.end_date
    LIMIT 1;

    IF v_fy_id IS NOT NULL THEN
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        VALUES
            (NEW.location_code, v_fy_id, 'LUBES_INVOICE', NEW.lubes_hdr_id, 'CREATE', NEW.invoice_date, 'UNPROCESSED', 'TRIGGER');
    END IF;
END$$

-- ── t_lubes_inv_hdr : UPDATE ──────────────────────────────────────────────────
-- Fires when status changes (DRAFT→CLOSED is the key transition) or financial
-- columns change.

CREATE TRIGGER trg_lubes_inv_gl_update
AFTER UPDATE ON t_lubes_inv_hdr
FOR EACH ROW
BEGIN
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    IF NOT (NEW.closing_status  <=> OLD.closing_status)
    OR NOT (NEW.supplier_id     <=> OLD.supplier_id)
    OR NOT (NEW.invoice_amount  <=> OLD.invoice_amount)
    OR NOT (NEW.invoice_date    <=> OLD.invoice_date)
    THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = NEW.location_code
          AND  NEW.invoice_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_processed_count
            FROM   gl_accounting_events
            WHERE  source_type = 'LUBES_INVOICE' AND source_id = NEW.lubes_hdr_id AND event_status = 'PROCESSED';

            SELECT COUNT(*) INTO v_pending_count
            FROM   gl_accounting_events
            WHERE  source_type = 'LUBES_INVOICE' AND source_id = NEW.lubes_hdr_id AND event_status = 'UNPROCESSED';

            IF v_processed_count > 0 THEN
                INSERT INTO gl_accounting_events
                    (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                VALUES
                    (NEW.location_code, v_fy_id, 'LUBES_INVOICE', NEW.lubes_hdr_id, 'UPDATE', NEW.invoice_date, 'UNPROCESSED', 'TRIGGER');
            ELSEIF v_pending_count > 0 THEN
                UPDATE gl_accounting_events
                SET    event_type = 'UPDATE'
                WHERE  source_type = 'LUBES_INVOICE' AND source_id = NEW.lubes_hdr_id AND event_status = 'UNPROCESSED';
            ELSE
                INSERT INTO gl_accounting_events
                    (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                VALUES
                    (NEW.location_code, v_fy_id, 'LUBES_INVOICE', NEW.lubes_hdr_id, 'CREATE', NEW.invoice_date, 'UNPROCESSED', 'TRIGGER');
            END IF;
        END IF;
    END IF;
END$$

-- ── t_lubes_inv_hdr : DELETE ──────────────────────────────────────────────────

CREATE TRIGGER trg_lubes_inv_gl_delete
AFTER DELETE ON t_lubes_inv_hdr
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'LUBES_INVOICE' AND source_id = OLD.lubes_hdr_id
    ORDER BY event_id DESC LIMIT 1;

    IF v_location_code IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'LUBES_INVOICE' AND source_id = OLD.lubes_hdr_id AND event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type = 'LUBES_INVOICE' AND source_id = OLD.lubes_hdr_id AND event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'LUBES_INVOICE', OLD.lubes_hdr_id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

-- ── t_tank_invoice : INSERT ───────────────────────────────────────────────────
-- location_id stores the location_code string.

CREATE TRIGGER trg_tank_inv_gl_insert
AFTER INSERT ON t_tank_invoice
FOR EACH ROW
BEGIN
    DECLARE v_fy_id INT;

    SELECT fy.fy_id INTO v_fy_id
    FROM   gl_financial_years fy
    WHERE  fy.location_code = NEW.location_id
      AND  NEW.invoice_date BETWEEN fy.start_date AND fy.end_date
    LIMIT 1;

    IF v_fy_id IS NOT NULL THEN
        INSERT INTO gl_accounting_events
            (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
        VALUES
            (NEW.location_id, v_fy_id, 'TANK_INVOICE', NEW.id, 'CREATE', NEW.invoice_date, 'UNPROCESSED', 'TRIGGER');
    END IF;
END$$

-- ── t_tank_invoice : UPDATE ───────────────────────────────────────────────────

CREATE TRIGGER trg_tank_inv_gl_update
AFTER UPDATE ON t_tank_invoice
FOR EACH ROW
BEGIN
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    IF NOT (NEW.total_invoice_amount <=> OLD.total_invoice_amount)
    OR NOT (NEW.supplier_id          <=> OLD.supplier_id)
    OR NOT (NEW.invoice_date         <=> OLD.invoice_date)
    THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = NEW.location_id
          AND  NEW.invoice_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_processed_count
            FROM   gl_accounting_events
            WHERE  source_type = 'TANK_INVOICE' AND source_id = NEW.id AND event_status = 'PROCESSED';

            SELECT COUNT(*) INTO v_pending_count
            FROM   gl_accounting_events
            WHERE  source_type = 'TANK_INVOICE' AND source_id = NEW.id AND event_status = 'UNPROCESSED';

            IF v_processed_count > 0 THEN
                INSERT INTO gl_accounting_events
                    (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                VALUES
                    (NEW.location_id, v_fy_id, 'TANK_INVOICE', NEW.id, 'UPDATE', NEW.invoice_date, 'UNPROCESSED', 'TRIGGER');
            ELSEIF v_pending_count > 0 THEN
                UPDATE gl_accounting_events
                SET    event_type = 'UPDATE'
                WHERE  source_type = 'TANK_INVOICE' AND source_id = NEW.id AND event_status = 'UNPROCESSED';
            ELSE
                INSERT INTO gl_accounting_events
                    (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                VALUES
                    (NEW.location_id, v_fy_id, 'TANK_INVOICE', NEW.id, 'CREATE', NEW.invoice_date, 'UNPROCESSED', 'TRIGGER');
            END IF;
        END IF;
    END IF;
END$$

-- ── t_tank_invoice : DELETE ───────────────────────────────────────────────────

CREATE TRIGGER trg_tank_inv_gl_delete
AFTER DELETE ON t_tank_invoice
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'TANK_INVOICE' AND source_id = OLD.id
    ORDER BY event_id DESC LIMIT 1;

    IF v_location_code IS NOT NULL THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'TANK_INVOICE' AND source_id = OLD.id AND event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type = 'TANK_INVOICE' AND source_id = OLD.id AND event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'TANK_INVOICE', OLD.id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

DELIMITER ;

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SHOW TRIGGERS WHERE `Table` IN ('t_lubes_inv_hdr', 't_tank_invoice');
