-- ============================================================
-- Fold cashflow types into m_ledger_rules — seed data
-- Generated: 2026-08-16
--
-- Note: m_ledger_rules has no real uniqueness on (location_code,
-- ledger_name) for source_type='Static' rows today — its declared unique
-- key is (location_code, bank_id, source_type, external_id), and Static
-- rows have NULL bank_id/external_id, which MySQL does not treat as
-- colliding. So this migration guards duplicates itself (NOT EXISTS) —
-- safe to re-run.
-- ============================================================

-- ── Step 1: existing Static rules that already share a name with a
--    real cashflow type — just mark them usable in cashflow ────────────────

UPDATE m_ledger_rules mlr
JOIN (
    SELECT DISTINCT ml.location_code, ml.description,
           MIN(ml.attribute1 + 0) AS seq,
           CASE ml.tag WHEN 'IN' THEN 'CREDIT' WHEN 'OUT' THEN 'DEBIT' END AS entry_type
    FROM m_lookup ml
    WHERE ml.lookup_type = 'CashFlow'
      AND EXISTS (SELECT 1 FROM t_cashflow_transaction tct WHERE tct.type = ml.description)
    GROUP BY ml.location_code, ml.description, ml.tag
) cf ON cf.location_code = mlr.location_code AND cf.description = mlr.ledger_name
SET mlr.usable_in_cashflow = 'Y',
    mlr.display_sequence   = COALESCE(mlr.display_sequence, cf.seq),
    mlr.is_system_type     = CASE WHEN mlr.ledger_name IN
        ('Balance B/F','Collection','2T Oil','Discount','Cashier A/C (+)','Cashier A/C (-)','Cash Receipt','Expense','Salary Payout','Salary Recovery')
        THEN 'Y' ELSE mlr.is_system_type END,
    mlr.updated_by = 'MIGRATION'
WHERE mlr.source_type = 'Static';

-- ── Step 2: everything else — create a new Static rule ─────────────────────

INSERT INTO m_ledger_rules
    (location_code, source_type, ledger_name, allowed_entry_type, usable_in_cashflow,
     display_sequence, is_system_type, created_by, updated_by)
SELECT cf.location_code, 'Static', cf.description, cf.entry_type, 'Y',
       cf.seq,
       CASE WHEN cf.description IN
           ('Balance B/F','Collection','2T Oil','Discount','Cashier A/C (+)','Cashier A/C (-)','Cash Receipt','Expense','Salary Payout','Salary Recovery')
           THEN 'Y' ELSE 'N' END,
       'MIGRATION', 'MIGRATION'
FROM (
    SELECT DISTINCT ml.location_code, ml.description,
           MIN(ml.attribute1 + 0) AS seq,
           CASE ml.tag WHEN 'IN' THEN 'CREDIT' WHEN 'OUT' THEN 'DEBIT' END AS entry_type
    FROM m_lookup ml
    WHERE ml.lookup_type = 'CashFlow'
      AND EXISTS (SELECT 1 FROM t_cashflow_transaction tct WHERE tct.type = ml.description)
    GROUP BY ml.location_code, ml.description, ml.tag
) cf
WHERE NOT EXISTS (
    SELECT 1 FROM m_ledger_rules mlr
    WHERE mlr.location_code = cf.location_code AND mlr.ledger_name = cf.description AND mlr.source_type = 'Static'
);

-- ── Step 3: guarantee the 9 system-generated types exist for EVERY
--    GL-enabled location, even ones that haven't triggered one yet —
--    generate_cashflow can produce any of these for any location the
--    moment a shift closes there. Tag is 100% consistent across every
--    location that has used each type (verified against real data before
--    writing this), so a single confirmed mapping is safe to apply broadly. ─

INSERT INTO m_ledger_rules
    (location_code, source_type, ledger_name, allowed_entry_type, usable_in_cashflow, is_system_type, created_by, updated_by)
SELECT loc.location_code, 'Static', t.name, t.entry_type, 'Y', 'Y', 'MIGRATION', 'MIGRATION'
FROM (SELECT DISTINCT location_code FROM gl_ledgers) loc
CROSS JOIN (
    SELECT 'Balance B/F' name, 'CREDIT' entry_type
    UNION ALL SELECT 'Collection', 'CREDIT'
    UNION ALL SELECT '2T Oil', 'CREDIT'
    UNION ALL SELECT 'Discount', 'DEBIT'
    UNION ALL SELECT 'Cashier A/C (+)', 'CREDIT'
    UNION ALL SELECT 'Cashier A/C (-)', 'DEBIT'
    UNION ALL SELECT 'Cash Receipt', 'CREDIT'
    UNION ALL SELECT 'Expense', 'DEBIT'
    UNION ALL SELECT 'Salary Payout', 'DEBIT'
    UNION ALL SELECT 'Salary Recovery', 'CREDIT'
) t
WHERE NOT EXISTS (
    SELECT 1 FROM m_ledger_rules mlr
    WHERE mlr.location_code = loc.location_code AND mlr.ledger_name = t.name AND mlr.source_type = 'Static'
);

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS total_cashflow_usable_rules FROM m_ledger_rules WHERE usable_in_cashflow = 'Y';
SELECT COUNT(*) AS total_system_type_rows FROM m_ledger_rules WHERE is_system_type = 'Y';
SELECT ledger_name, COUNT(DISTINCT location_code) AS loc_count
FROM m_ledger_rules WHERE is_system_type = 'Y' GROUP BY ledger_name ORDER BY ledger_name;
