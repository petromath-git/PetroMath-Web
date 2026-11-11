-- ============================================================
-- Leads Report — menu item for /dealer-leads/admin/report
--
-- Daily report of hot dealer leads, team call activity and a
-- WhatsApp-ready summary. Sits under Platform Billing (group
-- PLATFORM_BILLING, parent PLATFORM_BILLING_HEAD).
--
-- Route needs MANAGE_DEALER_LEADS and is blocked for TeleCaller,
-- so the menu goes to SuperUser + PowerUser (Deepan, Vikram).
-- PowerUser also needs the PLATFORM_BILLING_HEAD parent row, or the
-- child is silently dropped from the sidebar. That shows the
-- "Platform Billing" header to PowerUser with only this child under
-- it; the other Platform Billing children stay SuperUser-only.
--
-- Safe to re-run: NOT EXISTS guards.
-- ============================================================

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, restriction_level, group_code,
     effective_start_date, effective_end_date, created_by)
SELECT 'DEALER_LEADS_REPORT', 'Leads Report', 'bi-clipboard-data', '/dealer-leads/admin/report',
       'PLATFORM_BILLING_HEAD', 7, 1, 'PLATFORM_BILLING', CURDATE(), NULL, 'system'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_menu_items
                  WHERE menu_code = 'DEALER_LEADS_REPORT' OR url_path = '/dealer-leads/admin/report');

INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT r.role, 'DEALER_LEADS_REPORT', 1, CURDATE(), NULL, 'system'
FROM (SELECT 'SuperUser' AS role UNION ALL SELECT 'PowerUser') r
WHERE NOT EXISTS (SELECT 1 FROM m_menu_access_global g
                  WHERE g.role = r.role AND g.menu_code = 'DEALER_LEADS_REPORT');

INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT 'PowerUser', 'PLATFORM_BILLING_HEAD', 1, CURDATE(), NULL, 'system'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_menu_access_global g
                  WHERE g.role = 'PowerUser' AND g.menu_code = 'PLATFORM_BILLING_HEAD');

CALL RefreshMenuCache();

-- ── Verify ────────────────────────────────────────────────────────────
SELECT role, menu_code, COUNT(*) AS locations
FROM user_menu_cache
WHERE menu_code IN ('DEALER_LEADS_REPORT', 'PLATFORM_BILLING_HEAD')
GROUP BY role, menu_code;
