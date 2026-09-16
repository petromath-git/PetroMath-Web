-- ============================================================
-- GL Accounting: auto-create ledger master rows for
-- credit-party / supplier / bank creation
-- Generated: 2026-09-16
--
-- Today, creating a row in m_credit_list / m_supplier / m_bank does NOT
-- create a matching gl_ledgers row. resolveLedger() (create-accounting-
-- service.js) does a strict lookup keyed on (location_code, source_type,
-- source_id) and never auto-creates -- a customer/supplier/bank with no
-- ledger throws "GL ledger not found for ..." the first time a
-- transaction tries to post for it. Confirmed backlog on 2026-09-16
-- (dev DB): 406/946 credit parties, 26/59 suppliers, 23/61 banks had
-- no ledger.
--
-- Adds AFTER INSERT triggers on all three master tables, plus a
-- one-time backfill for the existing gap. Each insert is guarded two
-- ways:
--   1. Only fires for locations that already have the relevant ledger
--      group (Sundry Debtors / Sundry Creditors / Bank Accounts) --
--      locations with no GL setup at all (e.g. SSA2, HARI-AGENC) get
--      nothing, same as they get nothing today.
--   2. Skipped if a ledger with that exact name already exists at that
--      location (gl_ledgers has UNIQUE(location_code, ledger_name)) --
--      e.g. "MUTHU CORPORATION" already has a SUPPLIER ledger at MC2,
--      and a customer of the same name would collide; "STATE BANK OF
--      INDIA" has two separate m_bank rows at SFS with no distinguishing
--      suffix. These stay unlinked and will still throw "GL ledger not
--      found" at first posting -- same visible failure as today, just
--      for a narrower set of genuine name collisions instead of every
--      new party. An admin resolves them manually (rename, or give the
--      ledger a distinct tally_ledger_name) same as any other GL setup
--      task.
--
-- EMPLOYEE is intentionally not covered here -- no resolveLedger('EMPLOYEE', ...)
-- call exists yet, so there's no live posting path consuming it.
-- STATIC/SYSTEM ledgers are also out of scope -- they already go through
-- the reviewed gl_static_ledger_map, not a 1:1 master-row link (see
-- gl-static-ledger-map.sql).
-- ============================================================


-- ── Step 1: One-time backfill for the existing gap ─────────────────────────
-- INSERT ... WHERE NOT EXISTS makes this safe to re-run.

-- The "only one row per (location_code, name) among the rows being
-- inserted" filter (b.bank_id = MIN(...) below, same idea for the other
-- two) exists because NOT EXISTS above only sees ledgers that existed
-- BEFORE this statement started -- it does not stop two new, still-
-- unlinked master rows that share a name from colliding with EACH OTHER
-- inside the same INSERT ... SELECT. Hit in practice: PAC has two m_bank
-- rows both named "INDIAN OVERSEAS BANK" (bank_id 66, 67) -- both passed
-- the pre-statement NOT EXISTS, then the second one's actual INSERT
-- violated uniq_ledger_name. Picking MIN(id) links the first one and
-- leaves the sibling(s) unlinked, same as any other name collision.

INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, source_id, active_flag, created_by, updated_by)
SELECT cl.location_code, cl.Company_Name, g.group_id, 'CREDIT', cl.creditlist_id, 'Y', 'MIGRATION', 'MIGRATION'
FROM m_credit_list cl
JOIN gl_ledger_groups g ON g.location_code = cl.location_code AND g.group_name = 'Sundry Debtors'
WHERE NOT EXISTS (
    SELECT 1 FROM gl_ledgers l
    WHERE l.location_code = cl.location_code AND l.source_type = 'CREDIT' AND l.source_id = cl.creditlist_id
)
AND NOT EXISTS (
    SELECT 1 FROM gl_ledgers l2
    WHERE l2.location_code = cl.location_code AND l2.ledger_name = cl.Company_Name
)
AND cl.creditlist_id = (
    SELECT MIN(cl2.creditlist_id) FROM m_credit_list cl2
    WHERE cl2.location_code = cl.location_code AND cl2.Company_Name = cl.Company_Name
);

INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, source_id, active_flag, created_by, updated_by)
SELECT s.location_code, s.supplier_name, g.group_id, 'SUPPLIER', s.supplier_id, 'Y', 'MIGRATION', 'MIGRATION'
FROM m_supplier s
JOIN gl_ledger_groups g ON g.location_code = s.location_code AND g.group_name = 'Sundry Creditors'
WHERE s.location_code IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM gl_ledgers l
    WHERE l.location_code = s.location_code AND l.source_type = 'SUPPLIER' AND l.source_id = s.supplier_id
)
AND NOT EXISTS (
    SELECT 1 FROM gl_ledgers l2
    WHERE l2.location_code = s.location_code AND l2.ledger_name = s.supplier_name
)
AND s.supplier_id = (
    SELECT MIN(s2.supplier_id) FROM m_supplier s2
    WHERE s2.location_code = s.location_code AND s2.supplier_name = s.supplier_name
);

-- is_oil_company='Y' rows are not real bank accounts -- they're a bank-
-- shaped skeleton used only to upload an oil company's SOA file. Those
-- transactions resolve through the SUPPLIER ledger (m_bank.supplier_id ->
-- m_supplier), never a BANK ledger (see resolveLedger(location_code,
-- 'SUPPLIER', txn.supplier_id) for isOilCo in create-accounting-service.js).
-- A BANK ledger for one of these would never be used and would just be
-- confusing clutter in the ledger master list.
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, source_id, active_flag, created_by, updated_by)
SELECT b.location_code, b.bank_name, g.group_id, 'BANK', b.bank_id, 'Y', 'MIGRATION', 'MIGRATION'
FROM m_bank b
JOIN gl_ledger_groups g ON g.location_code = b.location_code AND g.group_name = 'Bank Accounts'
WHERE b.is_oil_company <> 'Y'
AND NOT EXISTS (
    SELECT 1 FROM gl_ledgers l
    WHERE l.location_code = b.location_code AND l.source_type = 'BANK' AND l.source_id = b.bank_id
)
AND NOT EXISTS (
    SELECT 1 FROM gl_ledgers l2
    WHERE l2.location_code = b.location_code AND l2.ledger_name = b.bank_name
)
AND b.bank_id = (
    SELECT MIN(b2.bank_id) FROM m_bank b2
    WHERE b2.location_code = b.location_code AND b2.bank_name = b.bank_name AND b2.is_oil_company <> 'Y'
);


-- ── Step 2: Triggers to keep new rows in sync going forward ───────────────

DROP TRIGGER IF EXISTS trg_credit_list_gl_ledger_insert;
DROP TRIGGER IF EXISTS trg_supplier_gl_ledger_insert;
DROP TRIGGER IF EXISTS trg_bank_gl_ledger_insert;

DELIMITER $$

CREATE TRIGGER trg_credit_list_gl_ledger_insert
AFTER INSERT ON m_credit_list
FOR EACH ROW
BEGIN
    DECLARE v_group_id INT;

    SELECT g.group_id INTO v_group_id
    FROM gl_ledger_groups g
    WHERE g.location_code = NEW.location_code AND g.group_name = 'Sundry Debtors'
    LIMIT 1;

    IF v_group_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM gl_ledgers l
           WHERE l.location_code = NEW.location_code AND l.ledger_name = NEW.Company_Name
       )
    THEN
        INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, source_id, active_flag, created_by, updated_by)
        VALUES (NEW.location_code, NEW.Company_Name, v_group_id, 'CREDIT', NEW.creditlist_id, 'Y', 'TRIGGER', 'TRIGGER');
    END IF;
END$$

CREATE TRIGGER trg_supplier_gl_ledger_insert
AFTER INSERT ON m_supplier
FOR EACH ROW
BEGIN
    DECLARE v_group_id INT;

    IF NEW.location_code IS NOT NULL THEN
        SELECT g.group_id INTO v_group_id
        FROM gl_ledger_groups g
        WHERE g.location_code = NEW.location_code AND g.group_name = 'Sundry Creditors'
        LIMIT 1;

        IF v_group_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM gl_ledgers l
               WHERE l.location_code = NEW.location_code AND l.ledger_name = NEW.supplier_name
           )
        THEN
            INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, source_id, active_flag, created_by, updated_by)
            VALUES (NEW.location_code, NEW.supplier_name, v_group_id, 'SUPPLIER', NEW.supplier_id, 'Y', 'TRIGGER', 'TRIGGER');
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_bank_gl_ledger_insert
AFTER INSERT ON m_bank
FOR EACH ROW
BEGIN
    DECLARE v_group_id INT;

    IF NEW.is_oil_company <> 'Y' THEN
        SELECT g.group_id INTO v_group_id
        FROM gl_ledger_groups g
        WHERE g.location_code = NEW.location_code AND g.group_name = 'Bank Accounts'
        LIMIT 1;

        IF v_group_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM gl_ledgers l
               WHERE l.location_code = NEW.location_code AND l.ledger_name = NEW.bank_name
           )
        THEN
            INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, source_id, active_flag, created_by, updated_by)
            VALUES (NEW.location_code, NEW.bank_name, v_group_id, 'BANK', NEW.bank_id, 'Y', 'TRIGGER', 'TRIGGER');
        END IF;
    END IF;
END$$

DELIMITER ;
