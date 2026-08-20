-- ============================================================
-- One-time backfill: gl_static_ledger_map row for every existing Account Head
-- Generated: 2026-08-20
--
-- AccountHeadsDao.createAccountHead now registers a matching
-- gl_static_ledger_map row (unreviewed) the moment a NEW Account Head is
-- created — see services/create-accounting-service.js /
-- dao/account-heads-dao.js changes deployed today. That only covers heads
-- created going forward through the app. Every Account Head seeded earlier
-- this session via raw SQL migration (cashflow-account-heads-correction-
-- seed.sql, the gap-fix, and whatever predates this session's work) bypassed
-- that code path entirely and was never backfilled — confirmed by spot-check
-- on MUE (Cashier A/C (+)/(-) show as Static Account Heads but have no
-- gl_static_ledger_map row) and system-wide (576 of 688 active Account Heads
-- missing one).
--
-- Safe to re-run — INSERT IGNORE, guarded by NOT EXISTS.
-- ============================================================

INSERT IGNORE INTO gl_static_ledger_map (location_code, ledger_name, created_by, updated_by)
SELECT ah.location_code, ah.account_head_name, 'MIGRATION', 'MIGRATION'
FROM m_account_heads ah
WHERE ah.active_flag = 'Y'
  AND NOT EXISTS (
      SELECT 1 FROM gl_static_ledger_map gsm
      WHERE gsm.location_code = ah.location_code AND gsm.ledger_name = ah.account_head_name
  );

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT
    COUNT(*) AS total_account_heads,
    SUM(EXISTS(SELECT 1 FROM gl_static_ledger_map gsm WHERE gsm.location_code=ah.location_code AND gsm.ledger_name=ah.account_head_name)) AS has_static_map_row,
    SUM(NOT EXISTS(SELECT 1 FROM gl_static_ledger_map gsm WHERE gsm.location_code=ah.location_code AND gsm.ledger_name=ah.account_head_name)) AS still_missing
FROM m_account_heads ah
WHERE ah.active_flag = 'Y';
