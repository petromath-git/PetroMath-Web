-- ============================================================
-- Dealer Leads — menu item for /dealer-leads/admin
--
-- The admin list existed but had no menu entry (reachable only by URL).
-- Route is SuperUser-only (security.isSuperUser()), so the menu is
-- granted to SuperUser only. Group ADMIN, next to Campaign Management.
--
-- Safe to re-run: NOT EXISTS guards (m_menu_access_global has no unique
-- key on (role, menu_code), so INSERT IGNORE would not dedupe).
-- ============================================================

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, group_code, effective_start_date, effective_end_date, created_by)
SELECT 'DEALER_LEADS', 'Dealer Leads', 'bi-person-lines-fill', '/dealer-leads/admin', NULL, 126, 'ADMIN', CURDATE(), '9999-12-31', 'system'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_menu_items WHERE url_path = '/dealer-leads/admin' OR menu_code = 'DEALER_LEADS');

INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT 'SuperUser', 'DEALER_LEADS', 1, CURDATE(), '9999-12-31', 'system'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM m_menu_access_global WHERE role = 'SuperUser' AND menu_code = 'DEALER_LEADS'
);

CALL RefreshMenuCache();

-- ── Verify — the nav reads user_menu_cache ────────────────────────────
SELECT role, COUNT(*) AS locations, MAX(group_name) AS menu_group
FROM user_menu_cache
WHERE url_path = '/dealer-leads/admin'
GROUP BY role;
