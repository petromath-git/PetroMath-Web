-- ============================================================================
-- Density @ 15°C calculator — menu item
--
-- The page itself (/density, public/density.html) is public and needs no login:
-- it is linked from the landing page and the login page as a free tool. This
-- adds it to the in-app menu (sidebar + phone tiles on /m) under Daily
-- Operations for station staff.
--
-- Granted per role, NOT with role '*' (a '*' row also shows to TeleCaller /
-- any new role).
--
-- Safe to re-run.
-- ============================================================================

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, restriction_level,
     effective_start_date, created_by, updated_by, group_code)
SELECT 'DENSITY_CALC', 'Density @ 15°C', 'bi-droplet-half', '/density',
       NULL, 65, 3, CURDATE(), 'system', 'system', 'DAILY_OPS'
WHERE NOT EXISTS (SELECT 1 FROM m_menu_items WHERE menu_code = 'DENSITY_CALC');

INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, created_by, updated_by)
SELECT r.role_name, 'DENSITY_CALC', 1, CURDATE(), 'system', 'system'
FROM m_roles r
WHERE r.role_name IN ('SuperUser', 'PowerUser', 'Admin', 'Manager', 'Cashier')
  AND NOT EXISTS (SELECT 1 FROM m_menu_access_global g
                  WHERE g.menu_code = 'DENSITY_CALC' AND g.role = r.role_name);

CALL RefreshMenuCache();
