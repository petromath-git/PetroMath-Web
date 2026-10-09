-- ============================================================
-- Speed Tests — menu item for /speedtest/results
--
-- Results + "test a user remotely" screen. Route is SuperUser-only
-- (security.isSuperUser()), so the menu is granted to SuperUser only.
-- Group ADMIN, right after System Health.
--
-- Safe to re-run: NOT EXISTS guards (m_menu_access_global has no unique
-- key on (role, menu_code), so INSERT IGNORE would not dedupe).
-- ============================================================

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, group_code, effective_start_date, effective_end_date, created_by)
SELECT 'SPEED_TESTS', 'Speed Tests', 'bi-speedometer2', '/speedtest/results', NULL, 141, 'ADMIN', CURDATE(), '9999-12-31', 'system'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_menu_items WHERE url_path = '/speedtest/results' OR menu_code = 'SPEED_TESTS');

INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT 'SuperUser', 'SPEED_TESTS', 1, CURDATE(), '9999-12-31', 'system'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM m_menu_access_global WHERE role = 'SuperUser' AND menu_code = 'SPEED_TESTS'
);

CALL RefreshMenuCache();

-- ── Verify — the nav reads user_menu_cache ────────────────────────────
SELECT role, COUNT(*) AS locations, MAX(group_name) AS menu_group
FROM user_menu_cache
WHERE url_path = '/speedtest/results'
GROUP BY role;
