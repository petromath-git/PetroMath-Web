-- ============================================================
-- GL Health Check — Menu Item & Access
-- Generated: 2026-10-15
--
-- Adds the Accounting Health Check page (/gl/health-check) to the
-- ACCOUNTING group, right after GL Control (sequence 8 -> 9).
--
-- Access = exactly GL Control's: every currently-active global row
-- (SuperUser, PowerUser) and location override (Admin at MC, MC2, MME,
-- MUE) for GL_CONTROL is copied to GL_HEALTH_CHECK. Top-level item, so
-- no parent header grant is needed.
--
-- Run on dev and prod. Safe to re-run: every insert is guarded with
-- NOT EXISTS. Ends with CALL RefreshMenuCache() (the nav reads the cache).
-- ============================================================

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, restriction_level,
     effective_start_date, created_by, updated_by, group_code)
SELECT 'GL_HEALTH_CHECK', 'Health Check', 'bi-clipboard2-pulse', '/gl/health-check', NULL, 9, 3,
       '2026-10-15', 'SAKTHI', 'SAKTHI', 'ACCOUNTING'
WHERE NOT EXISTS (SELECT 1 FROM m_menu_items WHERE menu_code = 'GL_HEALTH_CHECK');

INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, effective_end_date, created_by, updated_by)
SELECT g.role, 'GL_HEALTH_CHECK', g.allowed, '2026-10-15', NULL, 'gl-health-check-menu', 'gl-health-check-menu'
FROM m_menu_access_global g
WHERE g.menu_code = 'GL_CONTROL'
  AND CURDATE() BETWEEN g.effective_start_date AND IFNULL(g.effective_end_date, '9999-12-31')
  AND NOT EXISTS (SELECT 1 FROM m_menu_access_global x
                  WHERE x.role = g.role AND x.menu_code = 'GL_HEALTH_CHECK'
                    AND CURDATE() BETWEEN x.effective_start_date AND IFNULL(x.effective_end_date, '9999-12-31'));

INSERT INTO m_menu_access_override
    (role, location_code, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT o.role, o.location_code, 'GL_HEALTH_CHECK', o.allowed, '2026-10-15', NULL, 'gl-health-check-menu'
FROM m_menu_access_override o
WHERE o.menu_code = 'GL_CONTROL'
  AND CURDATE() BETWEEN o.effective_start_date AND IFNULL(o.effective_end_date, '9999-12-31')
  AND NOT EXISTS (SELECT 1 FROM m_menu_access_override x
                  WHERE x.role = o.role AND x.location_code = o.location_code AND x.menu_code = 'GL_HEALTH_CHECK'
                    AND CURDATE() BETWEEN x.effective_start_date AND IFNULL(x.effective_end_date, '9999-12-31'));

CALL RefreshMenuCache();

-- ── VERIFY: who sees GL Control vs Health Check (counts must match) ──────────
SELECT menu_code, COUNT(*) role_location_rows
FROM m_menu_access_v
WHERE menu_code IN ('GL_CONTROL', 'GL_HEALTH_CHECK') AND allowed = 1
GROUP BY menu_code;

SELECT menu_code, menu_name, url_path, sequence, group_code
FROM m_menu_items
WHERE group_code = 'ACCOUNTING' AND parent_code IS NULL
ORDER BY sequence;
