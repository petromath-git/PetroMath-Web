-- ============================================================
-- GL/Accounting read-only access via permission instead of isAdmin()
-- Owner request: Auditor role should see GL Control, Day Book, Ledger
-- Report, Trial Balance, P&L, Balance Sheet, Manual Journal (view),
-- Ledger Master, Static Ledger Map, Correction Queue, Tally Export
-- preview/history — without full admin rights (Create Accounting,
-- Manual Journal write/reverse, ledger/group edits, Tally
-- import/export-actual, and the Delete/Reset danger zone stay
-- isAdmin()-only, i.e. Manager/Admin/SuperUser).
--
-- routes/gl-routes.js: the 20 read-only GET routes were switched from
-- security.isAdmin() to security.hasPermission('VIEW_GL_ACCOUNTING');
-- the 22 write/destructive routes are untouched.
--
-- Global (location_code NULL) — GL Control was never location-scoped
-- via isAdmin() either, so this preserves that.
-- can_reset_role_id is NOT NULL with no default; existing non-
-- PASSWORD_RESET grants set it to the same value as role_id (see
-- VIEW_ACCOUNT_HEADS rows for Admin/SuperUser) — following that
-- established convention here. unique_role_permission
-- (role_id, can_reset_role_id, permission_type, location_code) makes
-- INSERT IGNORE safe to re-run.
-- ============================================================

INSERT IGNORE INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code, created_by)
SELECT r.role_id, r.role_id, 'VIEW_GL_ACCOUNTING', 0, CURDATE(), '2099-12-31', NULL, 'system'
FROM m_roles r WHERE r.role_name IN ('SuperUser', 'Admin', 'Manager', 'Auditor');

SELECT 'VIEW_GL_ACCOUNTING granted to SuperUser, Admin, Manager, Auditor (global).' AS status;
