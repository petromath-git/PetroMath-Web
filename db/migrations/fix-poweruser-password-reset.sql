-- ============================================================
-- Fix PowerUser PASSWORD_RESET permissions
--
-- Two bugs found while testing (2026-09-14/15):
--
-- 1. SuperUser was never granted PASSWORD_RESET for the PowerUser role
--    (PowerUser didn't exist when the original PASSWORD_RESET rows were
--    set up), so PowerUser accounts never show on SuperUser's password
--    reset page.
--
-- 2. partner-admin-role.sql's step-2 bulk copy hardcoded
--    can_reset_role_id = PowerUser's own role_id for every copied row,
--    following the standard "self-reference as NOT-NULL filler"
--    convention -- correct for every OTHER permission_type, but wrong
--    for PASSWORD_RESET, where can_reset_role_id is meaningful target
--    data, not filler. This collapsed 7 distinct SuperUser rows
--    (targeting Admin/Cashier/Customer/Driver/Helper/Manager/SuperUser)
--    into 7 duplicate, useless "PowerUser can reset PowerUser" rows,
--    losing the inherited ability to reset anyone else.
--
-- SuperUser itself is intentionally excluded as a target for PowerUser
-- (consistent with PowerUser being excluded from touching SuperUser
-- everywhere else in this rollout). PowerUser is also intentionally
-- excluded as a target for PowerUser -- decided 2026-09-15 to leave
-- PowerUser password resets as SuperUser-only for now, rather than let
-- one PowerUser reset another's password.
--
-- Run once. Safe to re-run: delete-then-reinsert + NOT EXISTS guard.
-- ============================================================

-- Remove the corrupted self-referential rows this migration's earlier
-- version created.
DELETE rp FROM m_role_permissions rp
JOIN m_roles r ON r.role_id = rp.role_id
WHERE r.role_name = 'PowerUser'
  AND rp.permission_type = 'PASSWORD_RESET'
  AND rp.can_reset_role_id = rp.role_id
  AND rp.created_by = 'partner-admin-role-migration';

-- Re-grant PowerUser the correct PASSWORD_RESET targets, mirroring
-- SuperUser's own targets minus SuperUser and PowerUser itself.
INSERT INTO m_role_permissions (role_id, can_reset_role_id, permission_type, location_specific, location_code, effective_start_date, effective_end_date, created_by)
SELECT pa.role_id, target.role_id, 'PASSWORD_RESET', 0, NULL, CURDATE(), '9999-12-31', 'fix-poweruser-password-reset'
FROM m_roles pa
JOIN m_roles target ON target.role_name IN ('Admin', 'Cashier', 'Customer', 'Driver', 'Helper', 'Manager')
WHERE pa.role_name = 'PowerUser'
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions existing
      WHERE existing.role_id = pa.role_id
        AND existing.permission_type = 'PASSWORD_RESET'
        AND existing.can_reset_role_id = target.role_id
  );

-- Grant SuperUser the ability to reset PowerUser accounts.
INSERT INTO m_role_permissions (role_id, can_reset_role_id, permission_type, location_specific, location_code, effective_start_date, effective_end_date, created_by)
SELECT su.role_id, pa.role_id, 'PASSWORD_RESET', 0, NULL, CURDATE(), '9999-12-31', 'fix-poweruser-password-reset'
FROM m_roles su
JOIN m_roles pa ON pa.role_name = 'PowerUser'
WHERE su.role_name = 'SuperUser'
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions existing
      WHERE existing.role_id = su.role_id
        AND existing.permission_type = 'PASSWORD_RESET'
        AND existing.can_reset_role_id = pa.role_id
  );
