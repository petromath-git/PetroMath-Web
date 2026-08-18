-- ============================================================
-- Gap fix: cashflow-account-heads-correction-seed.sql left two holes
-- Generated: 2026-08-17
--
-- Found by spot-checking SFS: comparing m_lookup(CashFlow) against
-- m_account_heads + cashflow-scoped m_ledger_rules turned up two distinct
-- gaps, both across every location, not just SFS:
--
-- 1. 30 Account Heads (all created_by='system', i.e. pre-existing from the
--    bank-categorization work, predating this session) share a name with a
--    real cashflow type but never got a cashflow-scoped Ledger Rule — the
--    original seed's Step 3 only covered heads it had just created
--    (created_by='MIGRATION'), wrongly skipping heads that already existed.
--
-- 2. 3 m_lookup(CashFlow) rows have no Account Head at all (MC/'MPDC
--    Cement', SFS/'To Bank SBI 8015', SFS/'PROFFSONAL CHARGES') — the
--    original seed only created a head when EXISTS-matched against real
--    t_cashflow_transaction usage, but these are valid configured dropdown
--    options that simply haven't been used yet. Since the cashflow entry
--    screen now sources its dropdown from Account Heads (not m_lookup
--    directly), an unused-but-valid option silently disappearing from the
--    dropdown is a real regression.
--
-- Safe to re-run — guarded with NOT EXISTS throughout.
-- ============================================================

-- ── Step 1: create Account Heads for the 3 m_lookup rows with none ────────

INSERT INTO m_account_heads
    (location_code, account_head_name, allowed_entry_type, is_system_type,
     effective_start_date, created_by, updated_by)
SELECT ml.location_code, ml.description,
       CASE ml.tag WHEN 'IN' THEN 'CREDIT' WHEN 'OUT' THEN 'DEBIT' END,
       'N', '2025-04-01', 'MIGRATION', 'MIGRATION'
FROM m_lookup ml
WHERE ml.lookup_type = 'CashFlow'
  AND ml.location_code IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM m_account_heads mah
      WHERE mah.location_code = ml.location_code AND mah.account_head_name = ml.description
  );

-- ── Step 2: cashflow-scoped Ledger Rule for every Account Head that
--    matches a real m_lookup CashFlow entry and doesn't have one yet —
--    regardless of who/what created the Account Head. ─────────────────────

INSERT INTO m_ledger_rules
    (location_code, source_type, external_id, ledger_name, allowed_entry_type,
     applies_to_cashflow, display_sequence, created_by, updated_by)
SELECT DISTINCT mah.location_code, 'Static', mah.account_head_id, mah.account_head_name,
       mah.allowed_entry_type, 'Y', seq.display_sequence, 'MIGRATION', 'MIGRATION'
FROM m_account_heads mah
INNER JOIN m_lookup ml
        ON ml.lookup_type = 'CashFlow'
       AND ml.location_code = mah.location_code
       AND ml.description   = mah.account_head_name
LEFT JOIN (
    SELECT DISTINCT location_code, description, MIN(attribute1 + 0) AS display_sequence
    FROM m_lookup WHERE lookup_type = 'CashFlow'
    GROUP BY location_code, description
) seq ON seq.location_code = mah.location_code AND seq.description = mah.account_head_name
WHERE NOT EXISTS (
    SELECT 1 FROM m_ledger_rules mlr
    WHERE mlr.location_code = mah.location_code AND mlr.external_id = mah.account_head_id
      AND mlr.source_type = 'Static' AND mlr.applies_to_cashflow = 'Y'
);

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS account_heads_created_this_pass FROM m_account_heads WHERE created_by = 'MIGRATION' AND creation_date >= NOW() - INTERVAL 5 MINUTE;

SELECT
  COUNT(*) AS total_lookup_rows,
  SUM(mah.account_head_id IS NULL) AS still_missing_account_head,
  SUM(mah.account_head_id IS NOT NULL AND mlr.rule_id IS NULL) AS still_missing_rule
FROM m_lookup ml
LEFT JOIN m_account_heads mah
       ON mah.location_code = ml.location_code AND mah.account_head_name = ml.description
LEFT JOIN m_ledger_rules mlr
       ON mlr.location_code = ml.location_code AND mlr.external_id = mah.account_head_id
      AND mlr.source_type = 'Static' AND mlr.applies_to_cashflow = 'Y'
WHERE ml.lookup_type = 'CashFlow' AND ml.location_code IS NOT NULL;
