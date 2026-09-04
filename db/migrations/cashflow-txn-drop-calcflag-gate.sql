-- ============================================================
-- CASHFLOW_TXN: drop calc_flag as the GL-posting gate
-- Generated: 2026-09-04
--
-- trg_cashflow_txn_gl_insert previously only raised a GL event for
-- calc_flag='N' rows (manually typed on the cashflow-close screen),
-- on the assumption that calc_flag='Y' rows (system-generated rollups
-- from shift closing — Collection, Balance B/F, 2T Oil, Cashier A/C (+/-),
-- Cash Receipt, Expense, Salary Payout, Salary Recovery, Discount) were
-- always duplicates of something already covered by CREDIT_SALE/CASH_SALE/
-- DAY_BILL. True for the rollup types, but not for 'Expense' — genuine
-- shift-level petty-cash spend (tea, bus fare, mechanic charges, etc.)
-- with no other GL representation anywhere, silently dropped.
--
-- Per-type POST/SKIP treatment is already reviewed and seeded in
-- gl_static_ledger_map (see cashflow-account-heads-correction-seed.sql /
-- gl-static-ledger-map-account-heads-backfill.sql) — rollup types are
-- explicitly SKIP (marked PROCESSED, 0 vouchers, no noise), 'Expense'/
-- 'Discount'/'Salary Payout'/'Salary Recovery' are explicitly POST to a
-- real ledger. That per-type map is now the actual gate; calc_flag
-- reverts to being a pure data-source signal (system vs. manually typed),
-- unrelated to GL posting.
--
-- trg_cashflow_txn_gl_update's calc_flag-flip cleanup branch (reverse/
-- drop an event when calc_flag changes away from 'N') is removed along
-- with it — irrelevant now that calc_flag no longer affects whether a
-- row is GL-eligible.
--
-- Does NOT backfill events for existing calc_flag='Y' rows already in
-- t_cashflow_transaction — only affects INSERT/UPDATE from this point
-- forward. Use GL Control → Generate Events (now also calc_flag-agnostic,
-- see create-accounting-service.js) to catch up historical rows.
-- ============================================================

DROP TRIGGER IF EXISTS trg_cashflow_txn_gl_insert;
DROP TRIGGER IF EXISTS trg_cashflow_txn_gl_update;

DELIMITER $$

CREATE TRIGGER trg_cashflow_txn_gl_insert
AFTER INSERT ON t_cashflow_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);
    DECLARE v_cf_date       DATE;
    DECLARE v_fy_id         INT;

    SELECT tcc.location_code, tcc.cashflow_date
    INTO   v_location_code, v_cf_date
    FROM   t_cashflow_closing tcc
    WHERE  tcc.cashflow_id = NEW.cashflow_id;

    IF v_location_code IS NOT NULL AND is_gl_accounting_enabled(v_location_code) THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = v_location_code
          AND  v_cf_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CASHFLOW_TXN', NEW.transaction_id, 'CREATE', v_cf_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_cashflow_txn_gl_update
AFTER UPDATE ON t_cashflow_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_cf_date         DATE;
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    IF NOT (NEW.amount      <=> OLD.amount)
    OR NOT (NEW.type        <=> OLD.type)
    OR NOT (NEW.description <=> OLD.description)
    THEN
        SELECT tcc.location_code, tcc.cashflow_date
        INTO   v_location_code, v_cf_date
        FROM   t_cashflow_closing tcc
        WHERE  tcc.cashflow_id = NEW.cashflow_id;

        IF v_location_code IS NOT NULL AND is_gl_accounting_enabled(v_location_code) THEN
            SELECT fy.fy_id INTO v_fy_id
            FROM   gl_financial_years fy
            WHERE  fy.location_code = v_location_code
              AND  v_cf_date BETWEEN fy.start_date AND fy.end_date
            LIMIT 1;

            IF v_fy_id IS NOT NULL THEN
                SELECT COUNT(*) INTO v_processed_count
                FROM   gl_accounting_events
                WHERE  source_type = 'CASHFLOW_TXN' AND source_id = NEW.transaction_id AND event_status = 'PROCESSED';

                SELECT COUNT(*) INTO v_pending_count
                FROM   gl_accounting_events
                WHERE  source_type = 'CASHFLOW_TXN' AND source_id = NEW.transaction_id AND event_status = 'UNPROCESSED';

                IF v_processed_count > 0 THEN
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (v_location_code, v_fy_id, 'CASHFLOW_TXN', NEW.transaction_id, 'UPDATE', v_cf_date, 'UNPROCESSED', 'TRIGGER');
                ELSEIF v_pending_count > 0 THEN
                    UPDATE gl_accounting_events
                    SET    event_type = 'UPDATE'
                    WHERE  source_type = 'CASHFLOW_TXN' AND source_id = NEW.transaction_id AND event_status = 'UNPROCESSED';
                ELSE
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (v_location_code, v_fy_id, 'CASHFLOW_TXN', NEW.transaction_id, 'CREATE', v_cf_date, 'UNPROCESSED', 'TRIGGER');
                END IF;
            END IF;
        END IF;
    END IF;
END$$

DELIMITER ;

-- ── Verify ──────────────────────────────────────────────────────────────────
SHOW TRIGGERS WHERE `Table` = 't_cashflow_transaction';
