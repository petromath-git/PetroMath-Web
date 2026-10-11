-- ============================================================
-- Bank -> Employee: classify bank lines (and splits) to an employee
-- Generated: 2026-10-11
--
-- Employee ledger bank movements come only from Bank (cash only from Day
-- Close). A bank line or split classified to an employee creates the linked
-- t_employee_ledger entry; reclassify / split / delete keep it in sync.
--
--   Bank ledger option (per bank, per active employee)    Ledger entry
--   "Salary Payout - <name> [<code>]"           (debit)    BANK_PAYMENT
--   "Salary Advance - <name> [<code>]"          (debit)    BANK_ADVANCE
--   "Salary Advance Recovery - <name> [<code>]" (credit)   BANK_RECOVERY
--
-- 1. t_employee_ledger.bank_txn_id / bank_split_id: link to the bank line/split.
-- 2. fn_employee_bank_ledger_name(): the option name (single definition, used
--    by the view and the triggers).
-- 3. m_bank_allowed_ledgers_v: live definition (prod = dev, 2026-10-11) plus an
--    Employee part, so upload, manual entry, reclassify, recon and splits all
--    offer employees without app changes. Split-enabled.
-- 4. BEFORE triggers (t_bank_transaction insert/update, splits insert): an
--    Employee option name sets external_source='Employee' + external_id
--    (covers recon bulk-add, which stores only the name) and rejects a purpose
--    on the wrong direction.
-- 5. sp_sync_bank_employee_entry + AFTER triggers: create / update / remove the
--    linked ledger entry. Deleting a bank line removes its entries directly
--    (split rows go by FK cascade, which fires no triggers).
--
-- Ledger entries from Bank are stamped cashflow_date = bank date: they are
-- never Day Close cash. GL posts them via the purpose's Static mapping
-- (create-accounting-service.js, same PR).
-- ============================================================

SET SESSION sql_mode = 'ALLOW_INVALID_DATES,NO_ENGINE_SUBSTITUTION';

ALTER TABLE t_employee_ledger
    ADD COLUMN bank_txn_id INT NULL
        COMMENT 't_bank_transaction.t_bank_id this BANK_* entry was created from (kept in sync by triggers)',
    ADD COLUMN bank_split_id INT NULL
        COMMENT 't_bank_transaction_splits.split_id when created from a split',
    ADD INDEX idx_employee_ledger_bank_txn (bank_txn_id),
    ADD INDEX idx_employee_ledger_bank_split (bank_split_id);

DROP FUNCTION IF EXISTS fn_employee_bank_ledger_name;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` FUNCTION fn_employee_bank_ledger_name(
    p_purpose VARCHAR(50), p_name VARCHAR(100), p_code VARCHAR(20))
RETURNS VARCHAR(100) CHARSET utf8mb4
DETERMINISTIC NO SQL
BEGIN
    RETURN LEFT(CONCAT(p_purpose, ' - ', p_name, ' [', p_code, ']'), 100);
END$$
DELIMITER ;

-- ---------- Allowed-ledgers view: live definition + Employee part ----------
CREATE OR REPLACE ALGORITHM=UNDEFINED DEFINER=`petromath_prod`@`%` SQL SECURITY DEFINER
VIEW `m_bank_allowed_ledgers_v` AS
select `lr`.`rule_id` AS `rule_id`,`lr`.`location_code` AS `location_code`,`lr`.`bank_id` AS `bank_id`,`lr`.`source_type` AS `source_type`,`lr`.`external_id` AS `external_id`,`lr`.`allowed_entry_type` AS `allowed_entry_type`,`lr`.`notes_required_flag` AS `notes_required_flag`,`lr`.`max_amount` AS `max_amount`,`lr`.`allow_split_flag` AS `allow_split_flag`,(case when (`lr`.`source_type` = 'Supplier') then `ms`.`supplier_name` when (`lr`.`source_type` = 'Credit') then convert(`mcl`.`Company_Name` using utf8mb4) when (`lr`.`source_type` = 'Static') then `lr`.`ledger_name` when (`lr`.`source_type` = 'Bank') then convert(`mb2`.`ledger_name` using utf8mb4) end) AS `ledger_name`,(case when (`lr`.`source_type` = 'Supplier') then `ms`.`supplier_short_name` when (`lr`.`source_type` = 'Credit') then convert(`mcl`.`Company_Name` using utf8mb4) when (`lr`.`source_type` = 'Static') then `lr`.`ledger_name` when (`lr`.`source_type` = 'Bank') then convert(concat(`mb2`.`bank_name`,if(((`mb2`.`account_nickname` is not null) and (`mb2`.`account_nickname` <> '')),concat(' (',`mb2`.`account_nickname`,')'),'')) using utf8mb4) end) AS `ledger_display_name` from (((`petromath_prod`.`m_ledger_rules` `lr` left join `petromath_prod`.`m_supplier` `ms` on(((`lr`.`source_type` = 'Supplier') and (`lr`.`external_id` = `ms`.`supplier_id`) and (coalesce(`ms`.`effective_end_date`,'9999-12-31') > curdate())))) left join `petromath_prod`.`m_credit_list` `mcl` on(((`lr`.`source_type` = 'Credit') and (`lr`.`external_id` = `mcl`.`creditlist_id`) and (coalesce(`mcl`.`effective_end_date`,'9999-12-31') > curdate())))) left join `petromath_prod`.`m_bank` `mb2` on(((`lr`.`source_type` = 'Bank') and (`lr`.`external_id` = `mb2`.`bank_id`) and (`mb2`.`active_flag` = 'Y')))) where ((`lr`.`source_type` = 'Static') or ((`lr`.`source_type` = 'Supplier') and (`ms`.`supplier_id` is not null)) or ((`lr`.`source_type` = 'Credit') and (`mcl`.`creditlist_id` is not null)) or ((`lr`.`source_type` = 'Bank') and (`mb2`.`bank_id` is not null)))
union all
select 0 AS `rule_id`, `e`.`location_code` AS `location_code`, `b`.`bank_id` AS `bank_id`,
       'Employee' AS `source_type`, `e`.`employee_id` AS `external_id`,
       `p`.`entry_type` AS `allowed_entry_type`, 'N' AS `notes_required_flag`, NULL AS `max_amount`,
       'Y' AS `allow_split_flag`,
       `fn_employee_bank_ledger_name`(`p`.`purpose`, `e`.`name`, `e`.`employee_code`) AS `ledger_name`,
       `fn_employee_bank_ledger_name`(`p`.`purpose`, `e`.`name`, `e`.`employee_code`) AS `ledger_display_name`
from `m_employee` `e`
join `m_bank` `b` on `b`.`location_code` = `e`.`location_code`
                 and `b`.`active_flag` = 'Y' and coalesce(`b`.`is_oil_company`, 'N') <> 'Y'
join (select 'Salary Payout' AS `purpose`, 'DEBIT' AS `entry_type`
      union all select 'Salary Advance', 'DEBIT'
      union all select 'Salary Advance Recovery', 'CREDIT') `p`
where `e`.`is_active` = 'Y'
order by 4, 11;

-- ---------- Sync procedure ----------
-- Reconciles the employee ledger entry for one bank line (p_split_id NULL) or
-- one split with the current classification; reads the row's current state.
DROP PROCEDURE IF EXISTS sp_sync_bank_employee_entry;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` PROCEDURE sp_sync_bank_employee_entry(
    IN p_bank_txn_id INT, IN p_split_id INT, IN p_user VARCHAR(50))
BEGIN
    DECLARE v_found      INT DEFAULT 0;
    DECLARE v_src        VARCHAR(50);
    DECLARE v_emp        INT;
    DECLARE v_name       VARCHAR(350);
    DECLARE v_date       DATE;
    DECLARE v_debit      DECIMAL(15,2) DEFAULT 0;
    DECLARE v_credit     DECIMAL(15,2) DEFAULT 0;
    DECLARE v_amount     DECIMAL(15,2) DEFAULT 0;
    DECLARE v_is_split   CHAR(1);
    DECLARE v_bank_id    INT;
    DECLARE v_loc        VARCHAR(50);
    DECLARE v_remarks    VARCHAR(1000);
    DECLARE v_type       VARCHAR(30) DEFAULT NULL;
    DECLARE v_ledger_id  INT DEFAULT NULL;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = 0;

    SET @ledger_action_by = CONCAT('BANK:', COALESCE(p_user, 'system'));

    IF p_split_id IS NULL THEN
        SET v_found = 1;
        SELECT b.external_source, b.external_id, b.ledger_name, b.trans_date,
               COALESCE(b.debit_amount, 0), COALESCE(b.credit_amount, 0),
               COALESCE(b.is_split, 'N'), b.bank_id, mb.location_code, b.remarks
          INTO v_src, v_emp, v_name, v_date, v_debit, v_credit, v_is_split, v_bank_id, v_loc, v_remarks
          FROM t_bank_transaction b JOIN m_bank mb ON mb.bank_id = b.bank_id
         WHERE b.t_bank_id = p_bank_txn_id;
        IF v_is_split = 'Y' THEN SET v_src = NULL; END IF;
        SET v_amount = IF(v_debit > 0, v_debit, v_credit);
    ELSE
        SET v_found = 1;
        SELECT s.external_source, s.external_id, s.ledger_name, b.trans_date,
               IF(COALESCE(b.debit_amount, 0) > 0, s.amount, 0), IF(COALESCE(b.debit_amount, 0) > 0, 0, s.amount),
               b.bank_id, mb.location_code, COALESCE(s.remarks, b.remarks), s.amount
          INTO v_src, v_emp, v_name, v_date, v_debit, v_credit, v_bank_id, v_loc, v_remarks, v_amount
          FROM t_bank_transaction_splits s
          JOIN t_bank_transaction b ON b.t_bank_id = s.t_bank_id
          JOIN m_bank mb ON mb.bank_id = b.bank_id
         WHERE s.split_id = p_split_id;
    END IF;

    IF v_found = 1 AND v_src = 'Employee' AND v_emp IS NOT NULL
       AND EXISTS (SELECT 1 FROM m_employee e WHERE e.employee_id = v_emp AND e.location_code = v_loc) THEN
        SET v_type = CASE
            WHEN v_name LIKE 'Salary Advance Recovery - %' AND v_credit > 0 THEN 'BANK_RECOVERY'
            WHEN v_name LIKE 'Salary Advance - %'          AND v_debit  > 0 THEN 'BANK_ADVANCE'
            WHEN v_name LIKE 'Salary Payout - %'           AND v_debit  > 0 THEN 'BANK_PAYMENT'
            ELSE NULL END;
    END IF;

    SELECT ledger_id INTO v_ledger_id
      FROM t_employee_ledger
     WHERE bank_txn_id = p_bank_txn_id AND bank_split_id <=> p_split_id
     LIMIT 1;

    IF v_type IS NULL OR v_amount <= 0 THEN
        DELETE FROM t_employee_ledger
         WHERE bank_txn_id = p_bank_txn_id AND bank_split_id <=> p_split_id;
    ELSEIF v_ledger_id IS NOT NULL THEN
        UPDATE t_employee_ledger
           SET employee_id = v_emp, location_code = v_loc, txn_date = v_date, txn_type = v_type,
               credit_amount = IF(v_type = 'BANK_RECOVERY', v_amount, 0),
               debit_amount  = IF(v_type = 'BANK_RECOVERY', 0, v_amount),
               bank_id = v_bank_id, cashflow_date = v_date, pending_cashflow_id = NULL
         WHERE ledger_id = v_ledger_id;
    ELSE
        INSERT INTO t_employee_ledger
            (employee_id, location_code, txn_date, txn_type, credit_amount, debit_amount,
             description, bank_id, bank_txn_id, bank_split_id, cashflow_date, created_by)
        VALUES
            (v_emp, v_loc, v_date, v_type,
             IF(v_type = 'BANK_RECOVERY', v_amount, 0), IF(v_type = 'BANK_RECOVERY', 0, v_amount),
             LEFT(CONCAT('Bank: ', COALESCE(v_remarks, '')), 255), v_bank_id, p_bank_txn_id, p_split_id,
             v_date, COALESCE(p_user, 'system'));
    END IF;
END$$
DELIMITER ;

-- ---------- Resolve + validate (BEFORE) ----------
-- Employee option name -> external_source/external_id; wrong direction rejected.
DROP PROCEDURE IF EXISTS sp_resolve_bank_employee;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` PROCEDURE sp_resolve_bank_employee(
    IN p_bank_id INT, IN p_ledger_name VARCHAR(350), IN p_is_debit TINYINT,
    OUT o_employee_id INT)
BEGIN
    SET o_employee_id = NULL;
    IF p_ledger_name LIKE 'Salary Payout - %' OR p_ledger_name LIKE 'Salary Advance - %'
       OR p_ledger_name LIKE 'Salary Advance Recovery - %' THEN
        SELECT e.employee_id INTO o_employee_id
          FROM m_employee e
          JOIN m_bank b ON b.bank_id = p_bank_id AND b.location_code = e.location_code
         WHERE p_ledger_name IN (fn_employee_bank_ledger_name('Salary Payout', e.name, e.employee_code),
                                 fn_employee_bank_ledger_name('Salary Advance', e.name, e.employee_code),
                                 fn_employee_bank_ledger_name('Salary Advance Recovery', e.name, e.employee_code))
         LIMIT 1;
        IF o_employee_id IS NOT NULL THEN
            IF p_ledger_name LIKE 'Salary Advance Recovery - %' AND p_is_debit = 1 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Salary Advance Recovery is money received - it cannot be used on a debit (money out) bank line.';
            END IF;
            IF p_ledger_name NOT LIKE 'Salary Advance Recovery - %' AND p_is_debit = 0 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Salary Payout / Salary Advance is money paid out - it cannot be used on a credit (money in) bank line.';
            END IF;
        END IF;
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_bank_txn_employee_resolve_ins;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_bank_txn_employee_resolve_ins
BEFORE INSERT ON t_bank_transaction FOR EACH ROW
BEGIN
    DECLARE v_emp INT;
    IF NEW.ledger_name IS NOT NULL AND COALESCE(NEW.is_split, 'N') = 'N' THEN
        CALL sp_resolve_bank_employee(NEW.bank_id, NEW.ledger_name, IF(COALESCE(NEW.debit_amount, 0) > 0, 1, 0), v_emp);
        IF v_emp IS NOT NULL THEN
            SET NEW.external_source = 'Employee', NEW.external_id = v_emp;
        END IF;
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_bank_txn_employee_resolve_upd;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_bank_txn_employee_resolve_upd
BEFORE UPDATE ON t_bank_transaction FOR EACH ROW
BEGIN
    DECLARE v_emp INT;
    IF NEW.ledger_name IS NOT NULL AND COALESCE(NEW.is_split, 'N') = 'N'
       AND NOT (NEW.ledger_name <=> OLD.ledger_name AND NEW.debit_amount <=> OLD.debit_amount
                AND NEW.credit_amount <=> OLD.credit_amount AND NEW.external_source <=> OLD.external_source
                AND NEW.external_id <=> OLD.external_id) THEN
        CALL sp_resolve_bank_employee(NEW.bank_id, NEW.ledger_name, IF(COALESCE(NEW.debit_amount, 0) > 0, 1, 0), v_emp);
        IF v_emp IS NOT NULL THEN
            SET NEW.external_source = 'Employee', NEW.external_id = v_emp;
        END IF;
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_bank_split_employee_resolve_ins;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_bank_split_employee_resolve_ins
BEFORE INSERT ON t_bank_transaction_splits FOR EACH ROW
BEGIN
    DECLARE v_emp INT;
    DECLARE v_bank_id INT;
    DECLARE v_is_debit TINYINT;
    IF NEW.ledger_name IS NOT NULL THEN
        SELECT bank_id, IF(COALESCE(debit_amount, 0) > 0, 1, 0) INTO v_bank_id, v_is_debit
          FROM t_bank_transaction WHERE t_bank_id = NEW.t_bank_id;
        CALL sp_resolve_bank_employee(v_bank_id, NEW.ledger_name, v_is_debit, v_emp);
        IF v_emp IS NOT NULL THEN
            SET NEW.external_source = 'Employee', NEW.external_id = v_emp;
        END IF;
    END IF;
END$$
DELIMITER ;

-- ---------- Keep the ledger entry in sync (AFTER) ----------
DROP TRIGGER IF EXISTS trg_bank_txn_employee_sync_ins;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_bank_txn_employee_sync_ins
AFTER INSERT ON t_bank_transaction FOR EACH ROW
BEGIN
    IF NEW.external_source = 'Employee' THEN
        CALL sp_sync_bank_employee_entry(NEW.t_bank_id, NULL, NEW.created_by);
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_bank_txn_employee_sync_upd;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_bank_txn_employee_sync_upd
AFTER UPDATE ON t_bank_transaction FOR EACH ROW
BEGIN
    IF (OLD.external_source = 'Employee' OR NEW.external_source = 'Employee')
       AND NOT (NEW.external_source <=> OLD.external_source AND NEW.external_id <=> OLD.external_id
                AND NEW.ledger_name <=> OLD.ledger_name AND NEW.debit_amount <=> OLD.debit_amount
                AND NEW.credit_amount <=> OLD.credit_amount AND NEW.trans_date <=> OLD.trans_date
                AND NEW.is_split <=> OLD.is_split AND NEW.bank_id <=> OLD.bank_id) THEN
        CALL sp_sync_bank_employee_entry(NEW.t_bank_id, NULL, NEW.updated_by);
    END IF;
    -- a split line's date/amount direction comes from the parent
    IF COALESCE(NEW.is_split, 'N') = 'Y'
       AND NOT (NEW.trans_date <=> OLD.trans_date AND NEW.debit_amount <=> OLD.debit_amount
                AND NEW.credit_amount <=> OLD.credit_amount) THEN
        BEGIN
            DECLARE v_done INT DEFAULT 0;
            DECLARE v_split INT;
            DECLARE cur CURSOR FOR SELECT split_id FROM t_bank_transaction_splits
                                   WHERE t_bank_id = NEW.t_bank_id AND external_source = 'Employee';
            DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;
            OPEN cur;
            split_loop: LOOP
                FETCH cur INTO v_split;
                IF v_done = 1 THEN LEAVE split_loop; END IF;
                CALL sp_sync_bank_employee_entry(NEW.t_bank_id, v_split, NEW.updated_by);
            END LOOP;
            CLOSE cur;
        END;
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_bank_txn_employee_sync_del;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_bank_txn_employee_sync_del
AFTER DELETE ON t_bank_transaction FOR EACH ROW
BEGIN
    -- includes split entries: splits are removed by FK cascade (no triggers fire)
    IF EXISTS (SELECT 1 FROM t_employee_ledger WHERE bank_txn_id = OLD.t_bank_id) THEN
        SET @ledger_action_by = CONCAT('BANK:', COALESCE(OLD.updated_by, 'system'));
        DELETE FROM t_employee_ledger WHERE bank_txn_id = OLD.t_bank_id;
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_bank_split_employee_sync_ins;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_bank_split_employee_sync_ins
AFTER INSERT ON t_bank_transaction_splits FOR EACH ROW
BEGIN
    IF NEW.external_source = 'Employee' THEN
        CALL sp_sync_bank_employee_entry(NEW.t_bank_id, NEW.split_id, NEW.created_by);
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_bank_split_employee_sync_upd;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_bank_split_employee_sync_upd
AFTER UPDATE ON t_bank_transaction_splits FOR EACH ROW
BEGIN
    IF OLD.external_source = 'Employee' OR NEW.external_source = 'Employee' THEN
        CALL sp_sync_bank_employee_entry(NEW.t_bank_id, NEW.split_id, NEW.created_by);
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_bank_split_employee_sync_del;
DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` TRIGGER trg_bank_split_employee_sync_del
AFTER DELETE ON t_bank_transaction_splits FOR EACH ROW
BEGIN
    IF EXISTS (SELECT 1 FROM t_employee_ledger WHERE bank_split_id = OLD.split_id) THEN
        SET @ledger_action_by = CONCAT('BANK:', COALESCE(OLD.created_by, 'system'));
        DELETE FROM t_employee_ledger WHERE bank_split_id = OLD.split_id;
    END IF;
END$$
DELIMITER ;

-- ---------- Checks ----------
SHOW COLUMNS FROM t_employee_ledger LIKE 'bank_%';
SELECT v.location_code, COUNT(*) AS employee_options
FROM m_bank_allowed_ledgers_v v WHERE v.source_type = 'Employee' AND v.location_code IN ('SFS', 'PAC')
GROUP BY v.location_code;
SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_ORDER
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE 'trg_bank%employee%'
ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION;
