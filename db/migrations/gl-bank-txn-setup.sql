-- ============================================================
-- GL Bank Transaction Event Triggers
-- Generated: 2026-04-30
--
-- Raises gl_accounting_events rows automatically on writes to:
--   t_bank_transaction        → BANK_TXN events  (source_id = t_bank_id)
--   t_bank_transaction_splits → BANK_TXN UPDATE event on parent t_bank_id
--
-- Prerequisites:
--   • m_bank.supplier_id column already exists (added in a prior migration)
--   • Populate m_bank.supplier_id for is_oil_company='Y' rows BEFORE triggering
--     live accounting, otherwise oil-company transactions will throw ledger errors.
--     See the "Link oil company banks" section below for per-location UPDATE pattern.
--
-- INSERT trigger:
--   Always raises a CREATE event. If accounting_type is NULL (not yet classified)
--   the service handler will skip it (mark PROCESSED, 0 vouchers).  When the user
--   later classifies the transaction, the UPDATE trigger fires and raises an UPDATE
--   event which the handler processes normally.
--
-- UPDATE trigger (t_bank_transaction):
--   Only fires when classification-relevant columns change:
--     accounting_type, external_source, external_id, ledger_name, is_split
--   Uses NULL-safe <=> operator to detect real changes.
--   Follows the same PROCESSED/UNPROCESSED/None logic as other GL triggers.
--
-- UPDATE/DELETE triggers (t_bank_transaction_splits):
--   Raise an UPDATE event on the parent t_bank_id so the handler can
--   re-read all splits and regenerate vouchers.
-- ============================================================


-- ── Link oil company banks to m_supplier ─────────────────────────────────────
-- Run this per-location to link each oil-company bank to its matching supplier.
-- Example — IOCL bank for location SFS:
--
--   UPDATE m_bank SET supplier_id = (
--       SELECT supplier_id FROM m_supplier
--       WHERE supplier_name LIKE '%INDIANOIL%' AND location_code = 'SFS'
--       LIMIT 1
--   ) WHERE bank_id = <iocl_bank_id_for_sfs>;
--
-- BPCL example:
--   UPDATE m_bank SET supplier_id = (
--       SELECT supplier_id FROM m_supplier
--       WHERE supplier_name LIKE '%BPCL%' AND location_code = 'SFS'
--       LIMIT 1
--   ) WHERE is_oil_company = 'Y' AND bank_name LIKE '%BPCL%' AND location_code = 'SFS';
--
-- After linking, verify with:
--   SELECT bank_id, bank_name, location_code, supplier_id
--   FROM m_bank WHERE is_oil_company = 'Y';
-- ─────────────────────────────────────────────────────────────────────────────


DROP TRIGGER IF EXISTS trg_bank_txn_gl_insert;
DROP TRIGGER IF EXISTS trg_bank_txn_gl_update;
DROP TRIGGER IF EXISTS trg_bank_txn_split_gl_insert;
DROP TRIGGER IF EXISTS trg_bank_txn_split_gl_delete;

DELIMITER $$

-- ── t_bank_transaction : INSERT ───────────────────────────────────────────────

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

    IF v_location_code IS NOT NULL THEN
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

-- ── t_bank_transaction : UPDATE ───────────────────────────────────────────────
-- Only fires when classification-relevant columns change.

CREATE TRIGGER trg_bank_txn_gl_update
AFTER UPDATE ON t_bank_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;
    DECLARE v_cols_changed    TINYINT DEFAULT 0;

    -- Check if any classification column changed (NULL-safe comparison)
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

        IF v_location_code IS NOT NULL THEN
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

-- ── t_bank_transaction_splits : INSERT ───────────────────────────────────────
-- A new split row means the parent transaction's accounting changes → UPDATE event.

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

    IF v_location_code IS NOT NULL THEN
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

-- ── t_bank_transaction_splits : DELETE ───────────────────────────────────────
-- Removing a split row also changes parent accounting → UPDATE event.

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

    IF v_location_code IS NOT NULL THEN
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
            -- If no event exists for a split delete, nothing to do (nothing was ever journaled)
            END IF;
        END IF;
    END IF;
END$$

DELIMITER ;

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SHOW TRIGGERS WHERE `Table` IN ('t_bank_transaction', 't_bank_transaction_splits');
