-- ============================================================
-- Correction: seed m_account_heads + cashflow-scoped m_ledger_rules
-- Generated: 2026-08-17
-- No unique key on (location_code, account_head_name) in m_account_heads —
-- guarded with NOT EXISTS throughout, safe to re-run.
-- ============================================================

-- ── Step 1: Account Heads — one per distinct real cashflow type ────────────
-- Reuse an existing Account Head with the same name if one's already there
-- (e.g. from bank-categorization work); only create when genuinely new.

INSERT INTO m_account_heads
    (location_code, account_head_name, allowed_entry_type, is_system_type,
     effective_start_date, created_by, updated_by)
SELECT cf.location_code, cf.description,
       CASE cf.tag WHEN 'IN' THEN 'CREDIT' WHEN 'OUT' THEN 'DEBIT' END,
       CASE WHEN cf.description IN
           ('Balance B/F','Collection','2T Oil','Discount','Cashier A/C (+)','Cashier A/C (-)','Cash Receipt','Expense','Salary Payout','Salary Recovery')
           THEN 'Y' ELSE 'N' END,
       '2025-04-01', 'MIGRATION', 'MIGRATION'
FROM (
    SELECT DISTINCT ml.location_code, ml.description, ml.tag
    FROM m_lookup ml
    WHERE ml.lookup_type = 'CashFlow'
      AND EXISTS (SELECT 1 FROM t_cashflow_transaction tct WHERE tct.type = ml.description)
) cf
WHERE NOT EXISTS (
    SELECT 1 FROM m_account_heads mah
    WHERE mah.location_code = cf.location_code AND mah.account_head_name = cf.description
);

-- ── Step 2: guarantee the 10 system-generated types exist for every
--    GL-enabled location, same reasoning as before (generate_cashflow can
--    fire any of them for any location). Tag confirmed 100% consistent
--    across every location that's used each type. ─────────────────────────

INSERT INTO m_account_heads
    (location_code, account_head_name, allowed_entry_type, is_system_type,
     effective_start_date, created_by, updated_by)
SELECT loc.location_code, t.name, t.entry_type, 'Y', '2025-04-01', 'MIGRATION', 'MIGRATION'
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
    SELECT 1 FROM m_account_heads mah
    WHERE mah.location_code = loc.location_code AND mah.account_head_name = t.name
);

-- ── Step 3: a cashflow-scoped Ledger Rule (applies_to_cashflow='Y') for
--    every Account Head that's actually used as a cashflow type — bank_id
--    NULL (not bank-scoped), external_id = the Account Head, ledger_name
--    denormalized to match createStaticRule's existing convention. ────────

INSERT INTO m_ledger_rules
    (location_code, source_type, external_id, ledger_name, allowed_entry_type,
     applies_to_cashflow, display_sequence, created_by, updated_by)
SELECT mah.location_code, 'Static', mah.account_head_id, mah.account_head_name,
       mah.allowed_entry_type, 'Y', seq.display_sequence, 'MIGRATION', 'MIGRATION'
FROM m_account_heads mah
LEFT JOIN (
    SELECT DISTINCT location_code, description, MIN(attribute1 + 0) AS display_sequence
    FROM m_lookup WHERE lookup_type = 'CashFlow'
    GROUP BY location_code, description
) seq ON seq.location_code = mah.location_code AND seq.description = mah.account_head_name
WHERE mah.created_by = 'MIGRATION'
  AND NOT EXISTS (
      SELECT 1 FROM m_ledger_rules mlr
      WHERE mlr.location_code = mah.location_code AND mlr.external_id = mah.account_head_id
        AND mlr.source_type = 'Static' AND mlr.applies_to_cashflow = 'Y'
  );

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS account_heads_created FROM m_account_heads WHERE created_by = 'MIGRATION';
SELECT COUNT(*) AS system_type_account_heads FROM m_account_heads WHERE is_system_type = 'Y';
SELECT COUNT(*) AS cashflow_scoped_rules FROM m_ledger_rules WHERE applies_to_cashflow = 'Y';
