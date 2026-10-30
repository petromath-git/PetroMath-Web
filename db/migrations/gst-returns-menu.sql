-- GST Returns (/gst): GSTR-1 JSON file from the GST Summary + how-to-file guide.
-- Adds the menu item next to the GST Summary report, with the same roles, unless a
-- /gst item already exists. No table changes: m_gst_config / t_gst_return_data exist.
-- The pages themselves are also restricted to admin roles in routes/gst-routes.js.

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, restriction_level,
     effective_start_date, created_by, updated_by, group_code)
SELECT 'GST_RETURNS', 'GST Returns', 'bi-file-earmark-arrow-up', '/gst',
       s.parent_code, s.sequence + 1, s.restriction_level, CURDATE(), 'system', 'system', s.group_code
FROM m_menu_items s
WHERE s.url_path = '/reports-gst-summary'
  AND NOT EXISTS (SELECT 1 FROM m_menu_items WHERE url_path = '/gst' OR menu_code = 'GST_RETURNS')
LIMIT 1;

INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, effective_end_date, created_by, updated_by)
SELECT g.role, 'GST_RETURNS', g.allowed, CURDATE(), g.effective_end_date, 'system', 'system'
FROM m_menu_access_global g
JOIN m_menu_items s ON s.menu_code = g.menu_code AND s.url_path = '/reports-gst-summary'
WHERE CURDATE() BETWEEN g.effective_start_date AND COALESCE(g.effective_end_date, '9999-12-31')
  AND EXISTS (SELECT 1 FROM m_menu_items WHERE menu_code = 'GST_RETURNS')
  AND NOT EXISTS (SELECT 1 FROM m_menu_access_global x
                  WHERE x.menu_code = 'GST_RETURNS' AND x.role = g.role);

CALL RefreshMenuCache();

-- Check
SELECT menu_code, menu_name, url_path, parent_code, sequence FROM m_menu_items WHERE url_path = '/gst';
SELECT role, allowed FROM m_menu_access_global WHERE menu_code = 'GST_RETURNS';
