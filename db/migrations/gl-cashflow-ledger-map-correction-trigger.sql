-- ============================================================
-- GL Accounting: correction-queue trigger on gl_cashflow_ledger_map
-- Generated: 2026-08-16
--
-- Completes the correction-queue coverage started for gl_product_ledger_map
-- and gl_static_ledger_map — same pattern, applied to the third mapping
-- table (CASHFLOW_TXN bank-deposit/withdrawal resolution).
--
-- Unlike gl_static_ledger_map, this table has no "seeded but unreviewed"
-- state — a row only ever exists once someone has deliberately mapped that
-- cashflow_type (bank_id or ledger_id), so every UPDATE/DELETE on an
-- existing row is a real change worth logging; no OLD-was-null guard is
-- needed the way gl_static_ledger_map's OLD.treatment check is.
-- ============================================================

DROP TRIGGER IF EXISTS trg_cashflow_ledger_map_gl_update;
DROP TRIGGER IF EXISTS trg_cashflow_ledger_map_gl_delete;

DELIMITER $$

CREATE TRIGGER trg_cashflow_ledger_map_gl_update
AFTER UPDATE ON gl_cashflow_ledger_map
FOR EACH ROW
BEGIN
    DECLARE v_old_name VARCHAR(250);
    DECLARE v_new_name VARCHAR(250);
    DECLARE v_old_desc VARCHAR(255);
    DECLARE v_new_desc VARCHAR(255);

    IF NOT (OLD.ledger_id <=> NEW.ledger_id) OR NOT (OLD.bank_id <=> NEW.bank_id) THEN
        IF OLD.bank_id IS NOT NULL THEN
            SELECT bank_name INTO v_old_name FROM m_bank WHERE bank_id = OLD.bank_id;
            SET v_old_desc = CONCAT('Contra to bank: ', COALESCE(v_old_name, CONCAT('(deleted bank #', OLD.bank_id, ')')));
        ELSE
            SELECT ledger_name INTO v_old_name FROM gl_ledgers WHERE ledger_id = OLD.ledger_id;
            SET v_old_desc = CONCAT('Post to: ', COALESCE(v_old_name, CONCAT('(deleted ledger #', OLD.ledger_id, ')')));
        END IF;

        IF NEW.bank_id IS NOT NULL THEN
            SELECT bank_name INTO v_new_name FROM m_bank WHERE bank_id = NEW.bank_id;
            SET v_new_desc = CONCAT('Contra to bank: ', COALESCE(v_new_name, CONCAT('(deleted bank #', NEW.bank_id, ')')));
        ELSE
            SELECT ledger_name INTO v_new_name FROM gl_ledgers WHERE ledger_id = NEW.ledger_id;
            SET v_new_desc = CONCAT('Post to: ', COALESCE(v_new_name, CONCAT('(deleted ledger #', NEW.ledger_id, ')')));
        END IF;

        INSERT INTO gl_correction_queue
            (location_code, mapping_source, mapping_key, old_description, new_description,
             source_type, source_id, voucher_id, fy_id, status, created_by)
        SELECT tcc.location_code, 'CASHFLOW_LEDGER_MAP', NEW.cashflow_type, v_old_desc, v_new_desc,
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
        FROM gl_accounting_events ge
        JOIN t_cashflow_transaction tct ON tct.transaction_id = ge.source_id AND ge.source_type = 'CASHFLOW_TXN'
        JOIN t_cashflow_closing tcc ON tcc.cashflow_id = tct.cashflow_id
        WHERE ge.event_status = 'PROCESSED' AND tcc.location_code = NEW.location_code AND tct.type = NEW.cashflow_type;
    END IF;
END$$

CREATE TRIGGER trg_cashflow_ledger_map_gl_delete
AFTER DELETE ON gl_cashflow_ledger_map
FOR EACH ROW
BEGIN
    DECLARE v_old_name VARCHAR(250);
    DECLARE v_old_desc VARCHAR(255);

    IF OLD.bank_id IS NOT NULL THEN
        SELECT bank_name INTO v_old_name FROM m_bank WHERE bank_id = OLD.bank_id;
        SET v_old_desc = CONCAT('Contra to bank: ', COALESCE(v_old_name, CONCAT('(deleted bank #', OLD.bank_id, ')')));
    ELSE
        SELECT ledger_name INTO v_old_name FROM gl_ledgers WHERE ledger_id = OLD.ledger_id;
        SET v_old_desc = CONCAT('Post to: ', COALESCE(v_old_name, CONCAT('(deleted ledger #', OLD.ledger_id, ')')));
    END IF;

    INSERT INTO gl_correction_queue
        (location_code, mapping_source, mapping_key, old_description, new_description,
         source_type, source_id, voucher_id, fy_id, status, created_by)
    SELECT tcc.location_code, 'CASHFLOW_LEDGER_MAP', OLD.cashflow_type, v_old_desc,
           'Removed (falls back to exact-name-match / Unclassified Cashflow)',
           ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', OLD.updated_by
    FROM gl_accounting_events ge
    JOIN t_cashflow_transaction tct ON tct.transaction_id = ge.source_id AND ge.source_type = 'CASHFLOW_TXN'
    JOIN t_cashflow_closing tcc ON tcc.cashflow_id = tct.cashflow_id
    WHERE ge.event_status = 'PROCESSED' AND tcc.location_code = OLD.location_code AND tct.type = OLD.cashflow_type;
END$$

DELIMITER ;

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.TRIGGERS
WHERE trigger_schema = DATABASE()
  AND trigger_name IN ('trg_cashflow_ledger_map_gl_update', 'trg_cashflow_ledger_map_gl_delete')
ORDER BY trigger_name;
