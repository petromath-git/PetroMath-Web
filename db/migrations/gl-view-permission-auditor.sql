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
-- established convention here.
-- NOT "INSERT IGNORE" here: unique_role_permission
-- (role_id, can_reset_role_id, permission_type, location_code) does NOT
-- actually dedupe a NULL location_code — MySQL unique indexes treat
-- NULL as distinct from NULL, so INSERT IGNORE would insert a second
-- row every re-run for a global (location_code IS NULL) grant like this
-- one. Confirmed the hard way: running this once by hand + once via
-- this file produced 8 rows instead of 4. Use an explicit NOT EXISTS
-- guard instead for any global permission grant.
-- ============================================================

INSERT INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code, created_by)
SELECT r.role_id, r.role_id, 'VIEW_GL_ACCOUNTING', 0, CURDATE(), '2099-12-31', NULL, 'system'
FROM m_roles r
WHERE r.role_name IN ('SuperUser', 'Admin', 'Manager', 'Auditor')
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions rp
      WHERE rp.role_id = r.role_id
        AND rp.permission_type = 'VIEW_GL_ACCOUNTING'
        AND rp.location_code IS NULL
  );

SELECT 'VIEW_GL_ACCOUNTING granted to SuperUser, Admin, Manager, Auditor (global).' AS status;
