-- Restrict ledger reclassify on Bank Transactions / SAP Transactions to Admin and above.
-- Routes PATCH /bank-statement/*reclassify* and /oil-company-statement/*reclassify*
-- now check these permissions instead of EDIT_BANK_STATEMENT / EDIT_OIL_COMPANY_STATEMENT,
-- so Manager keeps add/edit/split but loses reclassify.
--
-- Run BEFORE deploying the code, otherwise Admin/PowerUser/SuperUser briefly lose reclassify.
-- Re-runnable (NOT EXISTS guard). can_reset_role_id is NOT NULL — set to role_id per convention.

INSERT INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, location_code,
     created_by, effective_start_date, effective_end_date)
SELECT r.role_id, r.role_id, p.permission_type,
       CASE WHEN r.role_name = 'Admin' THEN 1 ELSE 0 END,
       NULL, 'reclassify-permission-migration', CURDATE(), '9999-12-31'
FROM m_roles r
CROSS JOIN (SELECT 'RECLASSIFY_BANK_STATEMENT' AS permission_type
            UNION ALL SELECT 'RECLASSIFY_OIL_COMPANY_STATEMENT') p
WHERE r.role_name IN ('SuperUser', 'Admin', 'PowerUser')
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions x
      WHERE x.role_id = r.role_id AND x.permission_type = p.permission_type
  );

-- Verify: expect 6 rows (3 roles x 2 permissions)
SELECT r.role_name, rp.permission_type, rp.location_specific, rp.effective_start_date, rp.effective_end_date
FROM m_role_permissions rp JOIN m_roles r ON r.role_id = rp.role_id
WHERE rp.permission_type IN ('RECLASSIFY_BANK_STATEMENT', 'RECLASSIFY_OIL_COMPANY_STATEMENT')
ORDER BY rp.permission_type, r.role_name;
