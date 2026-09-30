-- ============================================================
-- Campaign module hardening — MANAGE_CAMPAIGNS permission + menu
--
-- routes/campaign-routes.js now requires MANAGE_CAMPAIGNS on every
-- /campaigns admin route (previously any logged-in user could manage
-- campaigns of every location). The public quiz page /campaign/:code
-- stays open (no login).
--
-- RUN THIS BEFORE (or together with) deploying the code — until the
-- permission exists, /campaigns returns "Access Denied" for everyone.
--
-- Access: SuperUser, PowerUser, Admin only (owner decision 2026-09-30).
-- PowerUser exists on beta only for now — on a DB without that role
-- the grants simply skip it; re-run this after PowerUser is created.
--
-- Global grant (location_code NULL): campaigns are already scoped to
-- the user's current location in the controller.
-- can_reset_role_id is NOT NULL with no default — set to role_id, as
-- for other non-PASSWORD_RESET grants.
-- NOT "INSERT IGNORE": the unique index does not dedupe a NULL
-- location_code, so use an explicit NOT EXISTS guard (safe to re-run).
-- ============================================================

INSERT INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code, created_by)
SELECT r.role_id, r.role_id, 'MANAGE_CAMPAIGNS', 0, CURDATE(), '9999-12-31', NULL, 'system'
FROM m_roles r
WHERE r.role_name IN ('SuperUser', 'PowerUser', 'Admin')
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions rp
      WHERE rp.role_id = r.role_id
        AND rp.permission_type = 'MANAGE_CAMPAIGNS'
        AND rp.location_code IS NULL
  );

-- ── Menu item — only if nothing already points at /campaigns ──────────
-- The item already exists on beta (CAMPAIGNS, group ADMIN "Administration",
-- no parent, created 2026-01-11) — this only creates it where it's missing,
-- in the same group.
INSERT INTO m_menu_items
    (menu_code, menu_name, url_path, parent_code, sequence, group_code, effective_start_date, effective_end_date)
SELECT 'CAMPAIGNS', 'Campaigns', '/campaigns', NULL, 96, 'ADMIN', CURDATE(), '9999-12-31'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_menu_items WHERE url_path = '/campaigns' OR menu_code = 'CAMPAIGNS');

-- m_menu_access_global has no unique key on (role, menu_code) — INSERT IGNORE
-- would not dedupe, so guard with NOT EXISTS (safe to re-run).
INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT x.role, m.menu_code, 1, CURDATE(), '9999-12-31', 'system'
FROM m_menu_items m
JOIN (SELECT 'SuperUser' AS role UNION ALL SELECT 'PowerUser' UNION ALL SELECT 'Admin') x
WHERE m.url_path = '/campaigns'
  AND NOT EXISTS (
      SELECT 1 FROM m_menu_access_global g
      WHERE g.role = x.role AND g.menu_code = m.menu_code
  );

CALL RefreshMenuCache();

-- ── Verify (INSERTs above can silently do nothing) ─────────────────────
SELECT r.role_name, rp.permission_type, rp.location_code
FROM m_role_permissions rp JOIN m_roles r ON r.role_id = rp.role_id
WHERE rp.permission_type = 'MANAGE_CAMPAIGNS';

SELECT m.menu_code, m.url_path, m.parent_code, a.role, a.allowed
FROM m_menu_items m LEFT JOIN m_menu_access_global a ON a.menu_code = m.menu_code
WHERE m.url_path = '/campaigns';

-- The nav reads user_menu_cache — confirm the item actually landed there
-- (an existing /campaigns item may already be present with its own group)
SELECT menu_code, group_code, parent_code, effective_start_date, effective_end_date
FROM m_menu_items WHERE url_path = '/campaigns';

SELECT role, COUNT(*) AS locations, MAX(group_name) AS menu_group
FROM user_menu_cache
WHERE url_path = '/campaigns'
GROUP BY role;
