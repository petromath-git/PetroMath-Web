-- ============================================================
-- PartnerAdmin menu access (nav visibility) seeding
--
-- partner-admin-role.sql granted PartnerAdmin the feature permissions
-- (m_role_permissions) but never touched m_menu_access_global — the
-- separate table that controls which nav items actually render.
-- m_menu_access_v (and hence user_menu_cache) only includes roles that
-- appear in m_menu_access_global/m_menu_access_override at all, so
-- PartnerAdmin had zero cache rows and an empty sidebar.
--
-- Copies SuperUser's global menu access to PartnerAdmin, excluding the
-- same platform-only nav items PartnerAdmin is excluded from everywhere
-- else (billing, dev tooling, usage stats, assigning user locations).
--
-- Run once on each environment. Safe to re-run: guarded with NOT EXISTS.
-- Must be followed by CALL RefreshMenuCache(); (included at the bottom).
-- ============================================================

INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT
    'PartnerAdmin',
    src.menu_code,
    src.allowed,
    CURDATE(),
    '9999-12-31',
    'partner-admin-menu-access-migration'
FROM m_menu_access_global src
JOIN m_menu_items mi ON mi.menu_code = src.menu_code
WHERE src.role = 'SuperUser'
  AND CURDATE() BETWEEN src.effective_start_date AND IFNULL(src.effective_end_date, '9999-12-31')
  AND NOT (
        mi.url_path LIKE '/platform-billing%' OR mi.url_path LIKE '/usage-dashboard%' OR
        mi.url_path LIKE '/dev-tracker%' OR mi.url_path LIKE '/system-health%' OR
        mi.url_path LIKE '/person-locations%' OR mi.url_path LIKE '/dev-db-refresh%'
  )
  AND NOT EXISTS (
      SELECT 1 FROM m_menu_access_global existing
      WHERE existing.role = 'PartnerAdmin'
        AND existing.menu_code = src.menu_code
  );

CALL RefreshMenuCache();
