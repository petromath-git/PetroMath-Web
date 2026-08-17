-- ============================================================
-- Migrate existing gl_cashflow_ledger_map rows into gl_static_ledger_map
-- as CONTRA entries — folds the cashflow-specific bank-contra table into
-- the unified Static Ledger Map, same mechanism real bank contras use.
-- Generated: 2026-08-16
-- ============================================================

INSERT INTO gl_static_ledger_map (location_code, ledger_name, treatment, bank_id, created_by, updated_by)
SELECT location_code, cashflow_type, 'CONTRA', bank_id, 'MIGRATION', 'MIGRATION'
FROM gl_cashflow_ledger_map
WHERE bank_id IS NOT NULL
ON DUPLICATE KEY UPDATE treatment = 'CONTRA', bank_id = VALUES(bank_id), updated_by = 'MIGRATION';

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT map_id, location_code, ledger_name, treatment, bank_id FROM gl_static_ledger_map WHERE treatment = 'CONTRA';
