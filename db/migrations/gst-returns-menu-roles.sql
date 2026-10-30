-- GST Returns (/gst): only Admin, PowerUser and SuperUser (routes/gst-routes.js checks the same).
-- Turns it off for every other role (Manager globally; Auditor at a few locations via overrides)
-- and on for Admin at every location. Safe to run twice. Run after gst-returns-menu.sql.

UPDATE m_menu_access_global SET allowed = 0, updated_by = 'system'
WHERE menu_code = 'GST_RETURNS' AND role NOT IN ('Admin', 'PowerUser', 'SuperUser') AND allowed <> 0;

UPDATE m_menu_access_override SET allowed = 0, updated_by = 'system'
WHERE menu_code = 'GST_RETURNS' AND role NOT IN ('Admin', 'PowerUser', 'SuperUser') AND allowed <> 0;

UPDATE m_menu_access_global SET allowed = 1, updated_by = 'system'
WHERE menu_code = 'GST_RETURNS' AND role IN ('Admin', 'PowerUser', 'SuperUser') AND allowed <> 1;

INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, effective_end_date, created_by, updated_by)
SELECT r.role, 'GST_RETURNS', 1, CURDATE(), NULL, 'system', 'system'
FROM (SELECT 'Admin' AS role UNION ALL SELECT 'PowerUser' UNION ALL SELECT 'SuperUser') r
WHERE NOT EXISTS (SELECT 1 FROM m_menu_access_global x WHERE x.menu_code = 'GST_RETURNS' AND x.role = r.role);

CALL RefreshMenuCache();

-- Check: only Admin, PowerUser, SuperUser
SELECT role, COUNT(DISTINCT location_code) AS locations FROM user_menu_cache WHERE menu_code = 'GST_RETURNS' GROUP BY role;
