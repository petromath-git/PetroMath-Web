-- Day Close: reclassify a manually entered cashflow line to another type
-- (PATCH /cashflow-txn/:id/reclassify). Admin, PowerUser and SuperUser,
-- same as RECLASSIFY_BANK_STATEMENT (see reclassify-permission-admin-up.sql).
--
-- Run BEFORE deploying the code: without it the reclassify pencil simply
-- doesn't show, nothing breaks. Re-runnable (NOT EXISTS guard).
-- can_reset_role_id is NOT NULL - set to role_id per convention.

INSERT INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, location_code,
     created_by, effective_start_date, effective_end_date)
SELECT r.role_id, r.role_id, 'RECLASSIFY_CASHFLOW',
       CASE WHEN r.role_name = 'Admin' THEN 1 ELSE 0 END,
       NULL, 'reclassify-cashflow-migration', CURDATE(), '9999-12-31'
FROM m_roles r
WHERE r.role_name IN ('SuperUser', 'Admin', 'PowerUser')
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions x
      WHERE x.role_id = r.role_id AND x.permission_type = 'RECLASSIFY_CASHFLOW'
  );

-- Verify: expect 3 rows
SELECT r.role_name, rp.permission_type, rp.location_specific, rp.effective_start_date, rp.effective_end_date
FROM m_role_permissions rp JOIN m_roles r ON r.role_id = rp.role_id
WHERE rp.permission_type = 'RECLASSIFY_CASHFLOW'
ORDER BY r.role_name;
