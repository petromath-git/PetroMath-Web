-- ============================================================
-- Fold cashflow types into m_ledger_rules — backfill + auto-populate
-- Generated: 2026-08-16
--
-- generate_cashflow (the stored procedure behind calc_flag='Y' rows)
-- inserts t_cashflow_transaction rows by raw string only — it has no idea
-- ledger_rule_id exists. Rather than touch that procedure (long-standing,
-- clearly load-bearing — note generate_cashflow_old sitting next to it),
-- this trigger bridges string -> id after the fact for every insert,
-- system-generated or manual alike.
-- ============================================================

-- ── Step 1: backfill existing rows ─────────────────────────────────────────

UPDATE t_cashflow_transaction tct
JOIN t_cashflow_closing tcc ON tcc.cashflow_id = tct.cashflow_id
JOIN m_ledger_rules mlr ON mlr.location_code = tcc.location_code
    AND mlr.ledger_name = tct.type AND mlr.source_type = 'Static'
SET tct.ledger_rule_id = mlr.rule_id
WHERE tct.ledger_rule_id IS NULL;

-- ── Step 2: auto-populate on every future insert/update ────────────────────

DROP TRIGGER IF EXISTS trg_cashflow_txn_ledger_rule_insert;
DROP TRIGGER IF EXISTS trg_cashflow_txn_ledger_rule_update;

DELIMITER $$

CREATE TRIGGER trg_cashflow_txn_ledger_rule_insert
BEFORE INSERT ON t_cashflow_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);
    DECLARE v_rule_id INT;

    IF NEW.ledger_rule_id IS NULL AND NEW.type IS NOT NULL THEN
        SELECT location_code INTO v_location_code
        FROM t_cashflow_closing WHERE cashflow_id = NEW.cashflow_id;

        IF v_location_code IS NOT NULL THEN
            SELECT rule_id INTO v_rule_id
            FROM m_ledger_rules
            WHERE location_code = v_location_code AND ledger_name = NEW.type AND source_type = 'Static'
            LIMIT 1;
            SET NEW.ledger_rule_id = v_rule_id;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_cashflow_txn_ledger_rule_update
BEFORE UPDATE ON t_cashflow_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);
    DECLARE v_rule_id INT;

    IF NOT (OLD.type <=> NEW.type) THEN
        SELECT location_code INTO v_location_code
        FROM t_cashflow_closing WHERE cashflow_id = NEW.cashflow_id;

        IF v_location_code IS NOT NULL THEN
            SELECT rule_id INTO v_rule_id
            FROM m_ledger_rules
            WHERE location_code = v_location_code AND ledger_name = NEW.type AND source_type = 'Static'
            LIMIT 1;
            SET NEW.ledger_rule_id = v_rule_id;
        END IF;
    END IF;
END$$

DELIMITER ;

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS total_rows, SUM(ledger_rule_id IS NOT NULL) AS backfilled
FROM t_cashflow_transaction;
