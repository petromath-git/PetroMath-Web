-- ============================================================
-- GL: CREDIT_RECEIPT events from t_receipts
--
-- Credit-customer receipts never reached GL: t_receipts raised no event,
-- and the cashflow "Cash Receipt" line is deliberately SKIP in
-- gl_static_ledger_map (cash is journaled here instead, per receipt, so it
-- lands on the right customer). Bank-type receipts are journaled from the
-- linked t_bank_transaction, not from here -- the engine skips them.
--
-- Posting (services/create-accounting-service.js, processCreditReceiptEvent):
--   digital_creditlist_id set   -> Digital vendor DR / Customer CR   (Digital, Fleet Card)
--   receipt_type = 'Cash'       -> Cash-in-Hand DR   / Customer CR
--   anything else               -> no voucher (bank txn posts it, or 'others')
--
-- Triggers fire for every receipt (the engine decides what posts), gated by
-- is_gl_accounting_enabled() like the other GL triggers. Only columns that
-- change the journal raise an UPDATE -- generate_cashflow's frequent
-- pending_cashflow_id / cashflow_date writes are ignored.
--
-- After running: Generate Missing Events + Create Accounting for the FY to
-- backfill existing receipts.
-- ============================================================

DROP TRIGGER IF EXISTS trg_receipt_gl_insert;
DROP TRIGGER IF EXISTS trg_receipt_gl_update;
DROP TRIGGER IF EXISTS trg_receipt_gl_delete;

DELIMITER $$

CREATE TRIGGER trg_receipt_gl_insert
AFTER INSERT ON t_receipts
FOR EACH ROW
BEGIN
    DECLARE v_fy_id INT;

    IF NEW.location_code IS NOT NULL AND is_gl_accounting_enabled(NEW.location_code) THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = NEW.location_code
          AND  NEW.receipt_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (NEW.location_code, v_fy_id, 'CREDIT_RECEIPT', NEW.treceipt_id, 'CREATE', NEW.receipt_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_receipt_gl_update
AFTER UPDATE ON t_receipts
FOR EACH ROW
BEGIN
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    IF NOT (NEW.amount                <=> OLD.amount)
    OR NOT (NEW.creditlist_id         <=> OLD.creditlist_id)
    OR NOT (NEW.digital_creditlist_id <=> OLD.digital_creditlist_id)
    OR NOT (NEW.receipt_type          <=> OLD.receipt_type)
    OR NOT (NEW.receipt_date          <=> OLD.receipt_date)
    OR NOT (NEW.source_txn_id         <=> OLD.source_txn_id)
    OR NOT (NEW.location_code         <=> OLD.location_code)
    THEN
        IF NEW.location_code IS NOT NULL AND is_gl_accounting_enabled(NEW.location_code) THEN
            SELECT fy.fy_id INTO v_fy_id
            FROM   gl_financial_years fy
            WHERE  fy.location_code = NEW.location_code
              AND  NEW.receipt_date BETWEEN fy.start_date AND fy.end_date
            LIMIT 1;

            IF v_fy_id IS NOT NULL THEN
                SELECT COUNT(*) INTO v_processed_count
                FROM   gl_accounting_events
                WHERE  source_type = 'CREDIT_RECEIPT' AND source_id = NEW.treceipt_id AND event_status = 'PROCESSED';

                SELECT COUNT(*) INTO v_pending_count
                FROM   gl_accounting_events
                WHERE  source_type = 'CREDIT_RECEIPT' AND source_id = NEW.treceipt_id AND event_status = 'UNPROCESSED';

                IF v_processed_count > 0 THEN
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (NEW.location_code, v_fy_id, 'CREDIT_RECEIPT', NEW.treceipt_id, 'UPDATE', NEW.receipt_date, 'UNPROCESSED', 'TRIGGER');
                ELSEIF v_pending_count > 0 THEN
                    UPDATE gl_accounting_events
                    SET    event_type = 'UPDATE', event_date = NEW.receipt_date, fy_id = v_fy_id
                    WHERE  source_type = 'CREDIT_RECEIPT' AND source_id = NEW.treceipt_id AND event_status = 'UNPROCESSED';
                ELSE
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (NEW.location_code, v_fy_id, 'CREDIT_RECEIPT', NEW.treceipt_id, 'CREATE', NEW.receipt_date, 'UNPROCESSED', 'TRIGGER');
                END IF;
            END IF;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_receipt_gl_delete
AFTER DELETE ON t_receipts
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'CREDIT_RECEIPT' AND source_id = OLD.treceipt_id
    ORDER BY event_id DESC LIMIT 1;

    IF v_location_code IS NOT NULL AND is_gl_accounting_enabled(v_location_code) THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'CREDIT_RECEIPT' AND source_id = OLD.treceipt_id AND event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type = 'CREDIT_RECEIPT' AND source_id = OLD.treceipt_id AND event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CREDIT_RECEIPT', OLD.treceipt_id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

DELIMITER ;

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SHOW TRIGGERS WHERE `Trigger` LIKE 'trg_receipt_gl_%';
