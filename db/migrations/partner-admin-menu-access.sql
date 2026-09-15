-- ============================================================
-- PowerUser menu access (nav visibility) seeding
--
-- partner-admin-role.sql granted PowerUser the feature permissions
-- (m_role_permissions) but never touched m_menu_access_global — the
-- separate table that controls which nav items actually render.
-- m_menu_access_v (and hence user_menu_cache) only includes roles that
-- appear in m_menu_access_global/m_menu_access_override at all, so
-- PowerUser had zero cache rows and an empty sidebar.
--
-- Copies SuperUser's global menu access to PowerUser, excluding the same
-- platform-only nav items PowerUser is excluded from everywhere else
-- (billing, dev tooling, usage stats, assigning user locations, onboarding
-- creation, deleted-shifts restore).
--
-- Excluded by explicit menu_code list, not URL prefix: a URL-prefix check
-- cannot catch a parent/group header item (url_path is NULL, e.g.
-- PLATFORM_BILLING_HEAD) -- this is the same class of bug fixed properly
-- via m_menu_items.restriction_level in menu-item-restriction-level.sql,
-- applied here too since this file seeds PowerUser's own nav visibility,
-- a separate mechanism from restriction_level (which only governs what
-- PowerUser can grant to *others*).
--
-- Run once on each environment. Safe to re-run: guarded with NOT EXISTS.
-- Must be followed by CALL RefreshMenuCache(); (included at the bottom).
-- ============================================================

INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT
    'PowerUser',
    src.menu_code,
    src.allowed,
    CURDATE(),
    '9999-12-31',
    'partner-admin-menu-access-migration'
FROM m_menu_access_global src
JOIN m_menu_items mi ON mi.menu_code = src.menu_code
WHERE src.role = 'SuperUser'
  AND CURDATE() BETWEEN src.effective_start_date AND IFNULL(src.effective_end_date, '9999-12-31')
  AND mi.menu_code NOT IN (
        'ASSIGN_USER_LOCATIONS', 'DEV_DB_REFRESH', 'DEV_TRACKER', 'SYS_HEALTH',
        'USAGE_DASHBOARD', 'ONBOARDING_ADMIN', 'DELETED_SHIFTS',
        'PLATFORM_BILLING_HEAD', 'PLATFORM_BILLING_MASTER', 'PLATFORM_BILLING_PAYMENTS',
        'PLATFORM_BILLING_PLANS', 'PLATFORM_BILLING_LEDGER', 'PLATFORM_BILLING_MY_INVOICES',
        'DISTRIBUTOR_PAYABLES', 'DISTRIBUTOR_LEDGER'
  )
  AND NOT EXISTS (
      SELECT 1 FROM m_menu_access_global existing
      WHERE existing.role = 'PowerUser'
        AND existing.menu_code = src.menu_code
  );

CALL RefreshMenuCache();
