-- ============================================================
-- Fix trg_static_ledger_map_gl_update: two bugs found while investigating
-- why SFS's cashflow/bank vouchers weren't showing up correctly on the P&L
-- Generated: 2026-08-18 (documents a fix already applied live on beta)
--
-- Bug 1: `IF OLD.treatment IS NOT NULL` skipped queuing a correction
-- whenever a label's FIRST-EVER review happened after vouchers were already
-- posted using the unreviewed fallback (Unclassified Bank Transaction /
-- Unclassified Cashflow). That's exactly the case that needs catching —
-- vouchers post using the fallback long before anyone reviews the label.
--
-- Bug 2: the trigger only ever matched BANK_TXN events (joins to
-- t_bank_transaction) — no branch for CASHFLOW_TXN at all, since it
-- predated this session's cashflow/Account Heads work.
--
-- Both fixed below. This does NOT retroactively catch vouchers that were
-- already missed before this fix (see
-- cashflow-account-heads-correction-backfill.sql and the manual backfill
-- run for SFS this session for that).
-- ============================================================

DROP TRIGGER IF EXISTS trg_static_ledger_map_gl_update;

DELIMITER $$

CREATE TRIGGER trg_static_ledger_map_gl_update
AFTER UPDATE ON gl_static_ledger_map
FOR EACH ROW
BEGIN
    DECLARE v_old_ledger_name VARCHAR(250);
    DECLARE v_new_ledger_name VARCHAR(250);
    DECLARE v_old_desc VARCHAR(255);
    DECLARE v_new_desc VARCHAR(255);

    IF NOT (OLD.treatment <=> NEW.treatment)
       OR NOT (OLD.gl_ledger_id <=> NEW.gl_ledger_id)
       OR NOT (OLD.skip_reason <=> NEW.skip_reason)
    THEN
        IF OLD.treatment = 'SKIP' THEN
            SET v_old_desc = CONCAT('Skip: ', COALESCE(OLD.skip_reason, ''));
        ELSEIF OLD.treatment = 'POST' THEN
            SELECT ledger_name INTO v_old_ledger_name FROM gl_ledgers WHERE ledger_id = OLD.gl_ledger_id;
            SET v_old_desc = CONCAT('Post to: ', COALESCE(v_old_ledger_name, CONCAT('(deleted ledger #', OLD.gl_ledger_id, ')')));
        ELSE
            SET v_old_desc = 'Unreviewed';
        END IF;

        IF NEW.treatment = 'SKIP' THEN
            SET v_new_desc = CONCAT('Skip: ', COALESCE(NEW.skip_reason, ''));
        ELSEIF NEW.treatment = 'POST' THEN
            SELECT ledger_name INTO v_new_ledger_name FROM gl_ledgers WHERE ledger_id = NEW.gl_ledger_id;
            SET v_new_desc = CONCAT('Post to: ', COALESCE(v_new_ledger_name, CONCAT('(deleted ledger #', NEW.gl_ledger_id, ')')));
        ELSE
            SET v_new_desc = 'Unreviewed';
        END IF;

        INSERT INTO gl_correction_queue
            (location_code, mapping_source, mapping_key, old_description, new_description,
             source_type, source_id, voucher_id, fy_id, status, created_by)
        SELECT mb.location_code, 'STATIC_LEDGER_MAP', NEW.ledger_name, v_old_desc, v_new_desc,
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
        FROM gl_accounting_events ge
        JOIN t_bank_transaction tbt ON tbt.t_bank_id = ge.source_id AND ge.source_type = 'BANK_TXN'
        JOIN m_bank mb ON mb.bank_id = tbt.bank_id
        WHERE ge.event_status = 'PROCESSED' AND mb.location_code = NEW.location_code AND tbt.ledger_name = NEW.ledger_name

        UNION

        SELECT mb.location_code, 'STATIC_LEDGER_MAP', NEW.ledger_name, v_old_desc, v_new_desc,
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
        FROM gl_accounting_events ge
        JOIN t_bank_transaction tbt ON tbt.t_bank_id = ge.source_id AND ge.source_type = 'BANK_TXN'
        JOIN m_bank mb ON mb.bank_id = tbt.bank_id
        JOIN t_bank_transaction_splits tbs ON tbs.t_bank_id = tbt.t_bank_id
        WHERE ge.event_status = 'PROCESSED' AND mb.location_code = NEW.location_code AND tbs.ledger_name = NEW.ledger_name

        UNION

        SELECT tcc.location_code, 'STATIC_LEDGER_MAP', NEW.ledger_name, v_old_desc, v_new_desc,
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
        FROM gl_accounting_events ge
        JOIN t_cashflow_transaction tct ON tct.transaction_id = ge.source_id AND ge.source_type = 'CASHFLOW_TXN'
        JOIN t_cashflow_closing tcc ON tcc.cashflow_id = tct.cashflow_id
        WHERE ge.event_status = 'PROCESSED' AND tcc.location_code = NEW.location_code AND tct.type = NEW.ledger_name;
    END IF;
END$$

DELIMITER ;
