-- GST Returns (/gst): GSTR-1 / GSTR-3B self-filing pages.
-- A GST_RETURNS item already exists on beta and prod from an older GST screen (Jan-2026)
-- and was ended on 11-Aug-2026, so: add it if missing, otherwise reopen it.
-- Shown to SuperUser, PowerUser and Manager (rows added only where missing).
-- The pages themselves are also restricted to admin roles in routes/gst-routes.js.

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, restriction_level,
     effective_start_date, created_by, updated_by, group_code)
SELECT 'GST_RETURNS', 'GST Returns', 'bi-file-earmark-arrow-up', '/gst',
       s.parent_code, s.sequence + 5, s.restriction_level, CURDATE(), 'system', 'system', s.group_code
FROM m_menu_items s
WHERE s.url_path = '/reports-gst-summary'
  AND NOT EXISTS (SELECT 1 FROM m_menu_items WHERE menu_code = 'GST_RETURNS')
LIMIT 1;

UPDATE m_menu_items
SET effective_end_date = NULL, menu_name = 'GST Returns', icon = 'bi-file-earmark-arrow-up',
    url_path = '/gst', updated_by = 'system'
WHERE menu_code = 'GST_RETURNS';

INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, effective_end_date, created_by, updated_by)
SELECT r.role, 'GST_RETURNS', 1, CURDATE(), NULL, 'system', 'system'
FROM (SELECT 'SuperUser' AS role UNION ALL SELECT 'PowerUser' UNION ALL SELECT 'Manager') r
WHERE NOT EXISTS (SELECT 1 FROM m_menu_access_global x
                  WHERE x.menu_code = 'GST_RETURNS' AND x.role = r.role);

CALL RefreshMenuCache();

-- Check
SELECT menu_code, menu_name, url_path, parent_code, sequence, effective_end_date FROM m_menu_items WHERE menu_code = 'GST_RETURNS';
SELECT role, allowed, effective_end_date FROM m_menu_access_global WHERE menu_code = 'GST_RETURNS';
SELECT role, COUNT(DISTINCT location_code) AS locations FROM user_menu_cache WHERE menu_code = 'GST_RETURNS' GROUP BY role;
