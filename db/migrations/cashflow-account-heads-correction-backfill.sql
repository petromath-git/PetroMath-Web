-- ============================================================
-- Correction: backfill account_head_id + entry_type, repoint the trigger
-- Generated: 2026-08-17
-- Updated:   2026-08-17 — added system-type fallback for entry_type. Some
-- GL-enabled locations (e.g. NS) have real cashflow transactions using the
-- 10 system-protected types but never had a matching m_lookup(CashFlow) row
-- for them, so the m_lookup-only join left entry_type NULL even though
-- account_head_id resolved fine via the guaranteed system-type seeding.
-- The fallback below uses the same universal name -> direction mapping
-- already used in cashflow-account-heads-correction-seed.sql (confirmed
-- 100% consistent tag across every location for these 10 types).
--
-- entry_type is meant to be set at cashflow-entry time going forward (which
-- section of the screen the user filled in) — that UI change is separate,
-- future work. Until it ships, this trigger derives entry_type from
-- m_lookup.tag (falling back to the system-type mapping), so every row
-- always has a value and the GL engine never needs to guess or join
-- anything at processing time — it only ever reads columns already on the
-- row.
-- ============================================================

-- ── Step 1: backfill existing rows ─────────────────────────────────────────

UPDATE t_cashflow_transaction tct
JOIN t_cashflow_closing tcc ON tcc.cashflow_id = tct.cashflow_id
JOIN m_account_heads mah ON mah.location_code = tcc.location_code AND mah.account_head_name = tct.type
SET tct.account_head_id = mah.account_head_id
WHERE tct.account_head_id IS NULL;

UPDATE t_cashflow_transaction tct
JOIN t_cashflow_closing tcc ON tcc.cashflow_id = tct.cashflow_id
JOIN m_lookup ml ON ml.lookup_type = 'CashFlow' AND ml.description = tct.type
    AND (ml.location_code = tcc.location_code OR ml.location_code IS NULL)
SET tct.entry_type = CASE ml.tag WHEN 'IN' THEN 'CREDIT' WHEN 'OUT' THEN 'DEBIT' END
WHERE tct.entry_type IS NULL;

-- System-type fallback — closes the NS-style gap (m_lookup missing rows for
-- types m_account_heads was guaranteed-seeded with).
UPDATE t_cashflow_transaction tct
SET tct.entry_type = CASE tct.type
    WHEN 'Balance B/F' THEN 'CREDIT'
    WHEN 'Collection' THEN 'CREDIT'
    WHEN '2T Oil' THEN 'CREDIT'
    WHEN 'Discount' THEN 'DEBIT'
    WHEN 'Cashier A/C (+)' THEN 'CREDIT'
    WHEN 'Cashier A/C (-)' THEN 'DEBIT'
    WHEN 'Cash Receipt' THEN 'CREDIT'
    WHEN 'Expense' THEN 'DEBIT'
    WHEN 'Salary Payout' THEN 'DEBIT'
    WHEN 'Salary Recovery' THEN 'CREDIT'
    ELSE NULL
END
WHERE tct.entry_type IS NULL;

-- ── Step 2: repoint the auto-populate trigger ──────────────────────────────

DROP TRIGGER IF EXISTS trg_cashflow_txn_ledger_rule_insert;
DROP TRIGGER IF EXISTS trg_cashflow_txn_ledger_rule_update;

DELIMITER $$

CREATE TRIGGER trg_cashflow_txn_account_head_insert
BEFORE INSERT ON t_cashflow_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);

    IF NEW.type IS NOT NULL THEN
        SELECT location_code INTO v_location_code
        FROM t_cashflow_closing WHERE cashflow_id = NEW.cashflow_id;

        IF v_location_code IS NOT NULL THEN
            IF NEW.account_head_id IS NULL THEN
                SELECT account_head_id INTO @v_ah
                FROM m_account_heads
                WHERE location_code = v_location_code AND account_head_name = NEW.type
                LIMIT 1;
                SET NEW.account_head_id = @v_ah;
            END IF;

            IF NEW.entry_type IS NULL THEN
                SELECT CASE tag WHEN 'IN' THEN 'CREDIT' WHEN 'OUT' THEN 'DEBIT' END INTO @v_et
                FROM m_lookup
                WHERE lookup_type = 'CashFlow' AND description = NEW.type
                  AND (location_code = v_location_code OR location_code IS NULL)
                ORDER BY (location_code = v_location_code) DESC
                LIMIT 1;
                IF @v_et IS NULL THEN
                    SET @v_et = CASE NEW.type
                        WHEN 'Balance B/F' THEN 'CREDIT'
                        WHEN 'Collection' THEN 'CREDIT'
                        WHEN '2T Oil' THEN 'CREDIT'
                        WHEN 'Discount' THEN 'DEBIT'
                        WHEN 'Cashier A/C (+)' THEN 'CREDIT'
                        WHEN 'Cashier A/C (-)' THEN 'DEBIT'
                        WHEN 'Cash Receipt' THEN 'CREDIT'
                        WHEN 'Expense' THEN 'DEBIT'
                        WHEN 'Salary Payout' THEN 'DEBIT'
                        WHEN 'Salary Recovery' THEN 'CREDIT'
                        ELSE NULL
                    END;
                END IF;
                SET NEW.entry_type = @v_et;
            END IF;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_cashflow_txn_account_head_update
BEFORE UPDATE ON t_cashflow_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);

    IF NOT (OLD.type <=> NEW.type) THEN
        SELECT location_code INTO v_location_code
        FROM t_cashflow_closing WHERE cashflow_id = NEW.cashflow_id;

        IF v_location_code IS NOT NULL THEN
            SELECT account_head_id INTO @v_ah
            FROM m_account_heads
            WHERE location_code = v_location_code AND account_head_name = NEW.type
            LIMIT 1;
            SET NEW.account_head_id = @v_ah;

            SELECT CASE tag WHEN 'IN' THEN 'CREDIT' WHEN 'OUT' THEN 'DEBIT' END INTO @v_et
            FROM m_lookup
            WHERE lookup_type = 'CashFlow' AND description = NEW.type
              AND (location_code = v_location_code OR location_code IS NULL)
            ORDER BY (location_code = v_location_code) DESC
            LIMIT 1;
            IF @v_et IS NULL THEN
                SET @v_et = CASE NEW.type
                    WHEN 'Balance B/F' THEN 'CREDIT'
                    WHEN 'Collection' THEN 'CREDIT'
                    WHEN '2T Oil' THEN 'CREDIT'
                    WHEN 'Discount' THEN 'DEBIT'
                    WHEN 'Cashier A/C (+)' THEN 'CREDIT'
                    WHEN 'Cashier A/C (-)' THEN 'DEBIT'
                    WHEN 'Cash Receipt' THEN 'CREDIT'
                    WHEN 'Expense' THEN 'DEBIT'
                    WHEN 'Salary Payout' THEN 'DEBIT'
                    WHEN 'Salary Recovery' THEN 'CREDIT'
                    ELSE NULL
                END;
            END IF;
            SET NEW.entry_type = @v_et;
        END IF;
    END IF;
END$$

DELIMITER ;

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT COUNT(*) total_rows,
       SUM(account_head_id IS NOT NULL) has_account_head,
       SUM(entry_type IS NOT NULL) has_entry_type
FROM t_cashflow_transaction;
