-- Cashier Expense master (/expense-master) under Masters, for SuperUser,
-- PowerUser and Admin. Same role pattern as Bank Master. Safe to re-run.

-- 1. Menu item (menu_code is UNIQUE, so INSERT IGNORE is a real no-op on re-run)
INSERT IGNORE INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, group_code, effective_start_date, created_by)
VALUES
    ('MASTERS_EXPENSES', 'Cashier Expenses', 'bi-receipt', '/expense-master', 'MASTERS', 65, 'MASTERS', CURDATE(), 'system');

-- 2. Menu visibility (MASTERS parent is already granted to these roles via role '*')
INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, created_by)
SELECT r.role, 'MASTERS_EXPENSES', 1, CURDATE(), 'system'
FROM (SELECT 'SuperUser' AS role UNION ALL SELECT 'PowerUser' UNION ALL SELECT 'Admin') r
WHERE NOT EXISTS (
    SELECT 1 FROM m_menu_access_global g WHERE g.role = r.role AND g.menu_code = 'MASTERS_EXPENSES'
);

-- 3. Route permission. can_reset_role_id is NOT NULL (= role_id for non-reset
--    permissions), and location_code is NULL, so NOT EXISTS rather than
--    INSERT IGNORE (a UNIQUE key doesn't dedupe NULLs).
INSERT INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, location_code, created_by, effective_start_date, effective_end_date)
SELECT r.role_id, r.role_id, 'MANAGE_EXPENSE_MASTER',
       CASE WHEN r.role_name = 'Admin' THEN 1 ELSE 0 END,
       NULL, 'system', CURDATE(), '9999-12-31'
FROM m_roles r
WHERE r.role_name IN ('SuperUser', 'PowerUser', 'Admin')
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions rp
      WHERE rp.role_id = r.role_id AND rp.permission_type = 'MANAGE_EXPENSE_MASTER'
  );

CALL RefreshMenuCache();

-- Verify: expect 1 menu row, 3 access rows, 3 permission rows
SELECT 'menu' AS what, COUNT(*) AS n FROM m_menu_items WHERE menu_code = 'MASTERS_EXPENSES'
UNION ALL SELECT 'menu access', COUNT(*) FROM m_menu_access_global WHERE menu_code = 'MASTERS_EXPENSES'
UNION ALL SELECT 'permissions', COUNT(*) FROM m_role_permissions WHERE permission_type = 'MANAGE_EXPENSE_MASTER';
