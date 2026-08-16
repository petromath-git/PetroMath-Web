-- ============================================================
-- GL Accounting: correction-queue triggers on mapping tables
-- Generated: 2026-08-16
--
-- Moves correction-queue logging from application code (routes/gl-routes.js,
-- routes/products-routes.js) into DB triggers, so it catches every change
-- to gl_product_ledger_map / gl_static_ledger_map regardless of source —
-- the review screens, raw SQL run by hand, or a future migration. This
-- matters concretely: this session's own SFS mapping setup was done via
-- direct SQL, which app-level-only logging would have silently missed.
--
-- gl_product_ledger_map.ledger_id is NOT NULL — "unmapped" only exists as
-- row absence (DELETE), never a NULL value — so the UPDATE trigger never
-- needs to handle a NULL OLD/NEW ledger_id; only DELETE represents
-- "removed the mapping".
-- ============================================================


-- ── gl_product_ledger_map ──────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_product_ledger_map_gl_update;
DROP TRIGGER IF EXISTS trg_product_ledger_map_gl_delete;

DELIMITER $$

CREATE TRIGGER trg_product_ledger_map_gl_update
AFTER UPDATE ON gl_product_ledger_map
FOR EACH ROW
BEGIN
    DECLARE v_old_name VARCHAR(250);
    DECLARE v_new_name VARCHAR(250);
    DECLARE v_old_desc VARCHAR(255);
    DECLARE v_new_desc VARCHAR(255);
    DECLARE v_mapping_key VARCHAR(250);

    IF NOT (OLD.ledger_id <=> NEW.ledger_id) THEN
        SELECT ledger_name INTO v_old_name FROM gl_ledgers WHERE ledger_id = OLD.ledger_id;
        SELECT ledger_name INTO v_new_name FROM gl_ledgers WHERE ledger_id = NEW.ledger_id;
        SET v_old_desc = CONCAT('Post to: ', COALESCE(v_old_name, CONCAT('(deleted ledger #', OLD.ledger_id, ')')));
        SET v_new_desc = CONCAT('Post to: ', COALESCE(v_new_name, CONCAT('(deleted ledger #', NEW.ledger_id, ')')));
        SET v_mapping_key = CONCAT('product:', NEW.product_id, ':', NEW.map_type);

        IF NEW.map_type IN ('SALES', 'OUTPUT_CGST', 'OUTPUT_SGST') THEN
            INSERT INTO gl_correction_queue
                (location_code, mapping_source, mapping_key, old_description, new_description,
                 source_type, source_id, voucher_id, fy_id, status, created_by)
            SELECT NEW.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, v_new_desc,
                   ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
            FROM gl_accounting_events ge
            JOIN t_credits tc ON tc.tcredit_id = ge.source_id AND ge.source_type = 'CREDIT_SALE'
            WHERE ge.event_status = 'PROCESSED' AND ge.location_code = NEW.location_code AND tc.product_id = NEW.product_id
            UNION
            SELECT NEW.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, v_new_desc,
                   ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
            FROM gl_accounting_events ge
            JOIN t_cashsales cs ON cs.cashsales_id = ge.source_id AND ge.source_type = 'CASH_SALE'
            WHERE ge.event_status = 'PROCESSED' AND ge.location_code = NEW.location_code AND cs.product_id = NEW.product_id
            UNION
            SELECT NEW.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, v_new_desc,
                   ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
            FROM gl_accounting_events ge
            JOIN t_day_bill_header dbh ON dbh.day_bill_id = ge.source_id AND ge.source_type = 'DAY_BILL'
            JOIN t_day_bill_items dbi ON dbi.header_id = dbh.header_id
            WHERE ge.event_status = 'PROCESSED' AND ge.location_code = NEW.location_code AND dbi.product_id = NEW.product_id
            UNION
            SELECT NEW.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, v_new_desc,
                   ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
            FROM gl_accounting_events ge
            JOIN t_bowser_credits bc ON bc.credit_id = ge.source_id AND ge.source_type = 'BOWSER_CREDIT_SALE'
            WHERE ge.event_status = 'PROCESSED' AND ge.location_code = NEW.location_code AND bc.product_id = NEW.product_id
            UNION
            SELECT NEW.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, v_new_desc,
                   ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
            FROM gl_accounting_events ge
            JOIN t_bowser_cashsales bcs ON bcs.cashsale_id = ge.source_id AND ge.source_type = 'BOWSER_CASH_SALE'
            WHERE ge.event_status = 'PROCESSED' AND ge.location_code = NEW.location_code AND bcs.product_id = NEW.product_id
            UNION
            SELECT NEW.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, v_new_desc,
                   ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
            FROM gl_accounting_events ge
            JOIN t_bowser_digital_sales bds ON bds.digital_id = ge.source_id AND ge.source_type = 'BOWSER_DIGITAL_SALE'
            JOIN t_bowser_closing tbc ON tbc.bowser_closing_id = bds.bowser_closing_id
            JOIN m_bowser mb ON mb.bowser_id = tbc.bowser_id
            WHERE ge.event_status = 'PROCESSED' AND ge.location_code = NEW.location_code AND mb.product_id = NEW.product_id;
        ELSE
            INSERT INTO gl_correction_queue
                (location_code, mapping_source, mapping_key, old_description, new_description,
                 source_type, source_id, voucher_id, fy_id, status, created_by)
            SELECT NEW.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, v_new_desc,
                   ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
            FROM gl_accounting_events ge
            JOIN t_tank_invoice_dtl d ON d.invoice_id = ge.source_id AND ge.source_type = 'TANK_INVOICE'
            WHERE ge.event_status = 'PROCESSED' AND ge.location_code = NEW.location_code AND d.product_id = NEW.product_id
            UNION
            SELECT NEW.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, v_new_desc,
                   ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', NEW.updated_by
            FROM gl_accounting_events ge
            JOIN t_lubes_inv_lines l ON l.lubes_hdr_id = ge.source_id AND ge.source_type = 'LUBES_INVOICE'
            WHERE ge.event_status = 'PROCESSED' AND ge.location_code = NEW.location_code AND l.product_id = NEW.product_id;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_product_ledger_map_gl_delete
AFTER DELETE ON gl_product_ledger_map
FOR EACH ROW
BEGIN
    DECLARE v_old_name VARCHAR(250);
    DECLARE v_old_desc VARCHAR(255);
    DECLARE v_mapping_key VARCHAR(250);

    SELECT ledger_name INTO v_old_name FROM gl_ledgers WHERE ledger_id = OLD.ledger_id;
    SET v_old_desc = CONCAT('Post to: ', COALESCE(v_old_name, CONCAT('(deleted ledger #', OLD.ledger_id, ')')));
    SET v_mapping_key = CONCAT('product:', OLD.product_id, ':', OLD.map_type);

    IF OLD.map_type IN ('SALES', 'OUTPUT_CGST', 'OUTPUT_SGST') THEN
        INSERT INTO gl_correction_queue
            (location_code, mapping_source, mapping_key, old_description, new_description,
             source_type, source_id, voucher_id, fy_id, status, created_by)
        SELECT OLD.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, 'Unmapped',
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', OLD.updated_by
        FROM gl_accounting_events ge
        JOIN t_credits tc ON tc.tcredit_id = ge.source_id AND ge.source_type = 'CREDIT_SALE'
        WHERE ge.event_status = 'PROCESSED' AND ge.location_code = OLD.location_code AND tc.product_id = OLD.product_id
        UNION
        SELECT OLD.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, 'Unmapped',
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', OLD.updated_by
        FROM gl_accounting_events ge
        JOIN t_cashsales cs ON cs.cashsales_id = ge.source_id AND ge.source_type = 'CASH_SALE'
        WHERE ge.event_status = 'PROCESSED' AND ge.location_code = OLD.location_code AND cs.product_id = OLD.product_id
        UNION
        SELECT OLD.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, 'Unmapped',
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', OLD.updated_by
        FROM gl_accounting_events ge
        JOIN t_day_bill_header dbh ON dbh.day_bill_id = ge.source_id AND ge.source_type = 'DAY_BILL'
        JOIN t_day_bill_items dbi ON dbi.header_id = dbh.header_id
        WHERE ge.event_status = 'PROCESSED' AND ge.location_code = OLD.location_code AND dbi.product_id = OLD.product_id
        UNION
        SELECT OLD.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, 'Unmapped',
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', OLD.updated_by
        FROM gl_accounting_events ge
        JOIN t_bowser_credits bc ON bc.credit_id = ge.source_id AND ge.source_type = 'BOWSER_CREDIT_SALE'
        WHERE ge.event_status = 'PROCESSED' AND ge.location_code = OLD.location_code AND bc.product_id = OLD.product_id
        UNION
        SELECT OLD.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, 'Unmapped',
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', OLD.updated_by
        FROM gl_accounting_events ge
        JOIN t_bowser_cashsales bcs ON bcs.cashsale_id = ge.source_id AND ge.source_type = 'BOWSER_CASH_SALE'
        WHERE ge.event_status = 'PROCESSED' AND ge.location_code = OLD.location_code AND bcs.product_id = OLD.product_id
        UNION
        SELECT OLD.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, 'Unmapped',
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', OLD.updated_by
        FROM gl_accounting_events ge
        JOIN t_bowser_digital_sales bds ON bds.digital_id = ge.source_id AND ge.source_type = 'BOWSER_DIGITAL_SALE'
        JOIN t_bowser_closing tbc ON tbc.bowser_closing_id = bds.bowser_closing_id
        JOIN m_bowser mb ON mb.bowser_id = tbc.bowser_id
        WHERE ge.event_status = 'PROCESSED' AND ge.location_code = OLD.location_code AND mb.product_id = OLD.product_id;
    ELSE
        INSERT INTO gl_correction_queue
            (location_code, mapping_source, mapping_key, old_description, new_description,
             source_type, source_id, voucher_id, fy_id, status, created_by)
        SELECT OLD.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, 'Unmapped',
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', OLD.updated_by
        FROM gl_accounting_events ge
        JOIN t_tank_invoice_dtl d ON d.invoice_id = ge.source_id AND ge.source_type = 'TANK_INVOICE'
        WHERE ge.event_status = 'PROCESSED' AND ge.location_code = OLD.location_code AND d.product_id = OLD.product_id
        UNION
        SELECT OLD.location_code, 'PRODUCT_LEDGER_MAP', v_mapping_key, v_old_desc, 'Unmapped',
               ge.source_type, ge.source_id, ge.voucher_id, ge.fy_id, 'PENDING', OLD.updated_by
        FROM gl_accounting_events ge
        JOIN t_lubes_inv_lines l ON l.lubes_hdr_id = ge.source_id AND ge.source_type = 'LUBES_INVOICE'
        WHERE ge.event_status = 'PROCESSED' AND ge.location_code = OLD.location_code AND l.product_id = OLD.product_id;
    END IF;
END$$

DELIMITER ;


-- ── gl_static_ledger_map ────────────────────────────────────────────────────
-- treatment/gl_ledger_id ARE nullable here (unreviewed state) — only log
-- when OLD.treatment was already set (a real reviewed value being changed),
-- matching the "unmapped -> mapped never queues" rule.

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

    IF OLD.treatment IS NOT NULL
       AND (NOT (OLD.treatment <=> NEW.treatment)
            OR NOT (OLD.gl_ledger_id <=> NEW.gl_ledger_id)
            OR NOT (OLD.skip_reason <=> NEW.skip_reason))
    THEN
        IF OLD.treatment = 'SKIP' THEN
            SET v_old_desc = CONCAT('Skip: ', COALESCE(OLD.skip_reason, ''));
        ELSE
            SELECT ledger_name INTO v_old_ledger_name FROM gl_ledgers WHERE ledger_id = OLD.gl_ledger_id;
            SET v_old_desc = CONCAT('Post to: ', COALESCE(v_old_ledger_name, CONCAT('(deleted ledger #', OLD.gl_ledger_id, ')')));
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
        WHERE ge.event_status = 'PROCESSED' AND mb.location_code = NEW.location_code AND tbs.ledger_name = NEW.ledger_name;
    END IF;
END$$

DELIMITER ;


-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.TRIGGERS
WHERE trigger_schema = DATABASE()
  AND trigger_name IN ('trg_product_ledger_map_gl_update', 'trg_product_ledger_map_gl_delete',
                        'trg_static_ledger_map_gl_update')
ORDER BY trigger_name;
