-- ============================================================
-- GL Accounting: CASHFLOW_TXN + ADJUSTMENT event types
-- Generated: 2026-08-14
--
-- Adds GL coverage for the two gaps identified while scoping the
-- SFS P&L / FY2025-26 Tally export:
--   1. t_cashflow_transaction rows with calc_flag='N' (typed directly
--      into the cashflow-close screen — NOT a rollup of shift data,
--      so not already covered by CREDIT_SALE/CASH_SALE/DAY_BILL).
--   2. t_adjustments (customer/digital-vendor/supplier/bank corrections
--      and opening balances) — had zero GL wiring at all.
--
-- Does not touch any existing transaction data. Purely additive:
-- one new mapping table, five new ledgers (created only where GL is
-- already set up for a location), and gated triggers matching the
-- existing is_gl_accounting_enabled() pattern.
-- ============================================================


-- ── Step 1: Cashflow-type → ledger override table ─────────────────────────────
-- Optional. Most cashflow types resolve automatically by exact ledger-name
-- match (same convention as TANK_INVOICE charge_type). This table is only
-- needed for:
--   (a) bank deposit/withdrawal types, where the cashflow type name (e.g.
--       "To Bank CUB-7808") doesn't match any ledger name — set bank_id to
--       point at the m_bank row; the engine resolves that bank's own GL
--       ledger via the existing source_type='BANK' link.
--   (b) any type an accountant wants redirected to a specific ledger that
--       isn't named identically.
-- A type with no row here, and no exact-name-matching ledger, posts to the
-- per-location "Unclassified Cashflow" ledger (Step 2) instead of erroring —
-- so a non-accountant adding a new cashflow type never blocks processing.

CREATE TABLE IF NOT EXISTS gl_cashflow_ledger_map (
    map_id          INT NOT NULL AUTO_INCREMENT,
    location_code   VARCHAR(50)  NOT NULL,
    cashflow_type   VARCHAR(45)  NOT NULL COMMENT 'Matches m_lookup.description for lookup_type=CashFlow / t_cashflow_transaction.type',
    ledger_id       INT NULL COMMENT 'Explicit override target ledger. NULL if using bank_id instead.',
    bank_id         INT NULL COMMENT 'For bank deposit/withdrawal types — resolves via gl_ledgers.source_type=BANK/source_id=bank_id',
    created_by      VARCHAR(45),
    updated_by      VARCHAR(45),
    creation_date   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (map_id),
    UNIQUE KEY uq_gl_cashflow_ledger_map (location_code, cashflow_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── Step 2: Auto-create fallback / fixed ledgers per location ─────────────────
-- Only for locations that already have GL set up (i.e. already have at least
-- one row in gl_ledgers) — locations that don't use GL yet get nothing here.
-- INSERT ... WHERE NOT EXISTS makes this safe to re-run.

-- "Unclassified Cashflow" (Suspense A/c) — landing spot for calc_flag='N'
-- cashflow types with no ledger mapping yet. Sits on the Balance Sheet, not
-- the P&L, and is fully traceable back to the original transaction (and
-- reprocessable once mapped) via gl_journal_headers.source_type/source_id.
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT DISTINCT loc.location_code, 'Unclassified Cashflow', g.group_id, 'STATIC', 'Y', 'MIGRATION', 'MIGRATION'
FROM (SELECT DISTINCT location_code FROM gl_ledgers) loc
JOIN gl_ledger_groups g ON g.location_code = loc.location_code AND g.group_name = 'Suspense A/c'
WHERE NOT EXISTS (
    SELECT 1 FROM gl_ledgers x WHERE x.location_code = loc.location_code AND x.ledger_name = 'Unclassified Cashflow'
);

-- "General Adjustment" (Suspense A/c) — same role as above, for
-- t_adjustments rows whose adjustment_type has no matching ledger
-- (covers adjustment_type='REVERSAL' and any future unmapped type code).
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT DISTINCT loc.location_code, 'General Adjustment', g.group_id, 'STATIC', 'Y', 'MIGRATION', 'MIGRATION'
FROM (SELECT DISTINCT location_code FROM gl_ledgers) loc
JOIN gl_ledger_groups g ON g.location_code = loc.location_code AND g.group_name = 'Suspense A/c'
WHERE NOT EXISTS (
    SELECT 1 FROM gl_ledgers x WHERE x.location_code = loc.location_code AND x.ledger_name = 'General Adjustment'
);

-- "Opening Balance Equity" (Capital Account) — adjustment_type=201 (Opening
-- Balance Entry). Keeps historical opening positions off the P&L.
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT DISTINCT loc.location_code, 'Opening Balance Equity', g.group_id, 'STATIC', 'Y', 'MIGRATION', 'MIGRATION'
FROM (SELECT DISTINCT location_code FROM gl_ledgers) loc
JOIN gl_ledger_groups g ON g.location_code = loc.location_code AND g.group_name = 'Capital Account'
WHERE NOT EXISTS (
    SELECT 1 FROM gl_ledgers x WHERE x.location_code = loc.location_code AND x.ledger_name = 'Opening Balance Equity'
);

-- adjustment_type=205 "Digital Vendor Charges" (Indirect Expenses)
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT DISTINCT loc.location_code, 'Digital Vendor Charges', g.group_id, 'STATIC', 'Y', 'MIGRATION', 'MIGRATION'
FROM (SELECT DISTINCT location_code FROM gl_ledgers) loc
JOIN gl_ledger_groups g ON g.location_code = loc.location_code AND g.group_name = 'Indirect Expenses'
WHERE NOT EXISTS (
    SELECT 1 FROM gl_ledgers x WHERE x.location_code = loc.location_code AND x.ledger_name = 'Digital Vendor Charges'
);

-- adjustment_type=207 "POS Rental Charges" (Indirect Expenses)
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT DISTINCT loc.location_code, 'POS Rental Charges', g.group_id, 'STATIC', 'Y', 'MIGRATION', 'MIGRATION'
FROM (SELECT DISTINCT location_code FROM gl_ledgers) loc
JOIN gl_ledger_groups g ON g.location_code = loc.location_code AND g.group_name = 'Indirect Expenses'
WHERE NOT EXISTS (
    SELECT 1 FROM gl_ledgers x WHERE x.location_code = loc.location_code AND x.ledger_name = 'POS Rental Charges'
);


-- ── Step 3: CASHFLOW_TXN triggers on t_cashflow_transaction ───────────────────
-- Only calc_flag='N' rows raise events — calc_flag='Y' rows are a rollup of
-- shift data already covered by CREDIT_SALE/CASH_SALE/DAY_BILL.
-- Gated by is_gl_accounting_enabled(), same as every other trigger except
-- the (separately flagged, still-open) BANK_TXN gap.

DROP TRIGGER IF EXISTS trg_cashflow_txn_gl_insert;
DROP TRIGGER IF EXISTS trg_cashflow_txn_gl_update;
DROP TRIGGER IF EXISTS trg_cashflow_txn_gl_delete;

DELIMITER $$

CREATE TRIGGER trg_cashflow_txn_gl_insert
AFTER INSERT ON t_cashflow_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);
    DECLARE v_cf_date       DATE;
    DECLARE v_fy_id         INT;

    IF NEW.calc_flag = 'N' THEN
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

    IF NEW.calc_flag = 'N' THEN
        IF NOT (NEW.amount      <=> OLD.amount)
        OR NOT (NEW.type        <=> OLD.type)
        OR NOT (NEW.description <=> OLD.description)
        OR NOT (OLD.calc_flag   <=> NEW.calc_flag)
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
    ELSE
        -- calc_flag flipped away from 'N' (e.g. corrected to a rollup row) —
        -- clean up: reverse if already posted, drop if still pending.
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'CASHFLOW_TXN' AND source_id = NEW.transaction_id AND event_status = 'PROCESSED';

        IF v_processed_count > 0 THEN
            SELECT location_code, fy_id, event_date INTO v_location_code, v_fy_id, v_cf_date
            FROM   gl_accounting_events
            WHERE  source_type = 'CASHFLOW_TXN' AND source_id = NEW.transaction_id AND event_status = 'PROCESSED'
            ORDER BY event_id DESC LIMIT 1;

            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CASHFLOW_TXN', NEW.transaction_id, 'DELETE', v_cf_date, 'UNPROCESSED', 'TRIGGER');
        ELSE
            DELETE FROM gl_accounting_events
            WHERE  source_type = 'CASHFLOW_TXN' AND source_id = NEW.transaction_id AND event_status = 'UNPROCESSED';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_cashflow_txn_gl_delete
AFTER DELETE ON t_cashflow_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code   VARCHAR(50);
    DECLARE v_fy_id           INT;
    DECLARE v_event_date      DATE;
    DECLARE v_processed_count INT DEFAULT 0;

    SELECT location_code, fy_id, event_date
    INTO   v_location_code, v_fy_id, v_event_date
    FROM   gl_accounting_events
    WHERE  source_type = 'CASHFLOW_TXN' AND source_id = OLD.transaction_id
    ORDER BY event_id DESC LIMIT 1;

    IF v_location_code IS NOT NULL AND is_gl_accounting_enabled(v_location_code) THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'CASHFLOW_TXN' AND source_id = OLD.transaction_id AND event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type = 'CASHFLOW_TXN' AND source_id = OLD.transaction_id AND event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (v_location_code, v_fy_id, 'CASHFLOW_TXN', OLD.transaction_id, 'DELETE', v_event_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

DELIMITER ;


-- ── Step 4: ADJUSTMENT triggers on t_adjustments ───────────────────────────────
-- Only status='ACTIVE' rows raise/keep events.

DROP TRIGGER IF EXISTS trg_adjustment_gl_insert;
DROP TRIGGER IF EXISTS trg_adjustment_gl_update;
DROP TRIGGER IF EXISTS trg_adjustment_gl_delete;

DELIMITER $$

CREATE TRIGGER trg_adjustment_gl_insert
AFTER INSERT ON t_adjustments
FOR EACH ROW
BEGIN
    DECLARE v_fy_id INT;

    IF NEW.status = 'ACTIVE' AND is_gl_accounting_enabled(NEW.location_code) THEN
        SELECT fy.fy_id INTO v_fy_id
        FROM   gl_financial_years fy
        WHERE  fy.location_code = NEW.location_code
          AND  NEW.adjustment_date BETWEEN fy.start_date AND fy.end_date
        LIMIT 1;

        IF v_fy_id IS NOT NULL THEN
            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (NEW.location_code, v_fy_id, 'ADJUSTMENT', NEW.adjustment_id, 'CREATE', NEW.adjustment_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_adjustment_gl_update
AFTER UPDATE ON t_adjustments
FOR EACH ROW
BEGIN
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;
    DECLARE v_pending_count   INT DEFAULT 0;

    IF NEW.status = 'ACTIVE' AND is_gl_accounting_enabled(NEW.location_code) THEN
        IF NOT (NEW.debit_amount    <=> OLD.debit_amount)
        OR NOT (NEW.credit_amount   <=> OLD.credit_amount)
        OR NOT (NEW.external_id     <=> OLD.external_id)
        OR NOT (NEW.external_source <=> OLD.external_source)
        OR NOT (NEW.adjustment_type <=> OLD.adjustment_type)
        OR NOT (OLD.status          <=> NEW.status)
        THEN
            SELECT fy.fy_id INTO v_fy_id
            FROM   gl_financial_years fy
            WHERE  fy.location_code = NEW.location_code
              AND  NEW.adjustment_date BETWEEN fy.start_date AND fy.end_date
            LIMIT 1;

            IF v_fy_id IS NOT NULL THEN
                SELECT COUNT(*) INTO v_processed_count
                FROM   gl_accounting_events
                WHERE  source_type = 'ADJUSTMENT' AND source_id = NEW.adjustment_id AND event_status = 'PROCESSED';

                SELECT COUNT(*) INTO v_pending_count
                FROM   gl_accounting_events
                WHERE  source_type = 'ADJUSTMENT' AND source_id = NEW.adjustment_id AND event_status = 'UNPROCESSED';

                IF v_processed_count > 0 THEN
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (NEW.location_code, v_fy_id, 'ADJUSTMENT', NEW.adjustment_id, 'UPDATE', NEW.adjustment_date, 'UNPROCESSED', 'TRIGGER');
                ELSEIF v_pending_count > 0 THEN
                    UPDATE gl_accounting_events
                    SET    event_type = 'UPDATE'
                    WHERE  source_type = 'ADJUSTMENT' AND source_id = NEW.adjustment_id AND event_status = 'UNPROCESSED';
                ELSE
                    INSERT INTO gl_accounting_events
                        (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
                    VALUES
                        (NEW.location_code, v_fy_id, 'ADJUSTMENT', NEW.adjustment_id, 'CREATE', NEW.adjustment_date, 'UNPROCESSED', 'TRIGGER');
                END IF;
            END IF;
        END IF;
    ELSEIF is_gl_accounting_enabled(NEW.location_code) THEN
        -- status moved away from ACTIVE (e.g. cancelled) — reverse if posted, drop if pending
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'ADJUSTMENT' AND source_id = NEW.adjustment_id AND event_status = 'PROCESSED';

        IF v_processed_count > 0 THEN
            SELECT fy_id INTO v_fy_id
            FROM   gl_accounting_events
            WHERE  source_type = 'ADJUSTMENT' AND source_id = NEW.adjustment_id AND event_status = 'PROCESSED'
            ORDER BY event_id DESC LIMIT 1;

            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (NEW.location_code, v_fy_id, 'ADJUSTMENT', NEW.adjustment_id, 'DELETE', NEW.adjustment_date, 'UNPROCESSED', 'TRIGGER');
        ELSE
            DELETE FROM gl_accounting_events
            WHERE  source_type = 'ADJUSTMENT' AND source_id = NEW.adjustment_id AND event_status = 'UNPROCESSED';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_adjustment_gl_delete
AFTER DELETE ON t_adjustments
FOR EACH ROW
BEGIN
    DECLARE v_fy_id           INT;
    DECLARE v_processed_count INT DEFAULT 0;

    IF is_gl_accounting_enabled(OLD.location_code) THEN
        SELECT COUNT(*) INTO v_processed_count
        FROM   gl_accounting_events
        WHERE  source_type = 'ADJUSTMENT' AND source_id = OLD.adjustment_id AND event_status = 'PROCESSED';

        DELETE FROM gl_accounting_events
        WHERE  source_type = 'ADJUSTMENT' AND source_id = OLD.adjustment_id AND event_status IN ('UNPROCESSED', 'ERROR');

        IF v_processed_count > 0 THEN
            SELECT fy_id INTO v_fy_id
            FROM   gl_financial_years
            WHERE  location_code = OLD.location_code
              AND  OLD.adjustment_date BETWEEN start_date AND end_date
            LIMIT 1;

            INSERT INTO gl_accounting_events
                (location_code, fy_id, source_type, source_id, event_type, event_date, event_status, created_by)
            VALUES
                (OLD.location_code, v_fy_id, 'ADJUSTMENT', OLD.adjustment_id, 'DELETE', OLD.adjustment_date, 'UNPROCESSED', 'TRIGGER');
        END IF;
    END IF;
END$$

DELIMITER ;


-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT 'Ledger' AS object_type, location_code, ledger_name
FROM   gl_ledgers
WHERE  ledger_name IN ('Unclassified Cashflow', 'General Adjustment', 'Opening Balance Equity', 'Digital Vendor Charges', 'POS Rental Charges')
UNION ALL
SELECT 'Trigger', NULL, trigger_name
FROM   information_schema.TRIGGERS
WHERE  trigger_schema = DATABASE()
  AND  (trigger_name LIKE 'trg_cashflow_txn_gl_%' OR trigger_name LIKE 'trg_adjustment_gl_%')
ORDER BY object_type, location_code, ledger_name;
