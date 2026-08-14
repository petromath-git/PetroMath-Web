-- ============================================================
-- Employee Ledger Report — read-only access for Manager role at SFS
-- Owner request: SFS managers should be able to see employee balances
-- (Statement + Spending Summary) without full employee master access
-- (no add/edit/disable/ledger-entry/salary-generation rights).
-- Safe to re-run: uses INSERT IGNORE / idempotent UPDATE throughout.
-- ============================================================

-- ── Permission: VIEW_EMPLOYEE_REPORT — read-only report access ────────────────
-- Distinct from VIEW_EMPLOYEE (which also unlocks the full employee list/detail
-- pages, where edit/ledger/salary buttons are shown based on isAdmin — Manager
-- is already an admin role app-wide, so granting VIEW_EMPLOYEE there would
-- surface edit controls that then 403 on click). Scoped to SFS only.
-- can_reset_role_id is NOT NULL with no default; existing non-PASSWORD_RESET
-- grants set it to the same value as role_id (see VIEW_EMPLOYEE rows for
-- Admin/SuperUser) — following that established convention here.
INSERT IGNORE INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, r.role_id, 'VIEW_EMPLOYEE_REPORT', 1, CURDATE(), '9999-12-31', 'SFS'
FROM m_roles r WHERE r.role_name = 'Manager';

-- ── Menu access — reuse the existing "Employee Report" menu item ──────────────
-- (menu_code EMPLOYEE_REPORT, /employees/report, created 2026-03-27) rather than
-- adding a duplicate. Manager/SFS only.
INSERT IGNORE INTO m_menu_access_override
    (role, location_code, menu_code, allowed, effective_start_date, effective_end_date, created_by)
VALUES
    ('Manager', 'SFS', 'EMPLOYEE_REPORT', 1, CURDATE(), '9999-12-31', 'system');

-- ── Cleanup: remove the duplicate menu item this migration mistakenly created
--    on its first run (EMPLOYEE_LEDGER_REPORT duplicated EMPLOYEE_REPORT) ─────
DELETE FROM m_menu_access_override WHERE menu_code = 'EMPLOYEE_LEDGER_REPORT';
DELETE FROM m_menu_items WHERE menu_code = 'EMPLOYEE_LEDGER_REPORT';

-- ── Deactivate pre-existing Manager/SFS overrides that link to the full
--    editable /employees screen (EMPLOYEES, EMPLOYEE_LEDGER menu codes) ───────
-- Manager should only reach the read-only report, not the edit-capable
-- master/ledger screen (those links currently 403 anyway since Manager lacks
-- VIEW_EMPLOYEE, but leaving them live is misleading and a latent risk if
-- VIEW_EMPLOYEE is ever granted to Manager for an unrelated reason later).
UPDATE m_menu_access_override
SET effective_end_date = CURDATE() - INTERVAL 1 DAY, updated_by = 'system'
WHERE role = 'Manager' AND location_code = 'SFS' AND menu_code IN ('EMPLOYEES', 'EMPLOYEE_LEDGER')
  AND (effective_end_date IS NULL OR effective_end_date >= CURDATE());

CALL RefreshMenuCache();

SELECT 'Employee Ledger Report access granted to Manager role at SFS (read-only, dedup + old links removed).' AS status;
