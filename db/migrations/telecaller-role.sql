-- ============================================================
-- TeleCaller role — Dealer Leads only
--
-- For the telecalling staff who follow up PetroMath's own sales leads
-- (t_dealer_lead). They get the Dealer Leads page and nothing else:
--   - MANAGE_DEALER_LEADS (global grant — leads are not location-scoped)
--   - the DEALER_LEADS menu item
--   - SuperUser may reset their password
-- The app also confines a TeleCaller session to /dealer-leads (app.js) and
-- lands them there after login (utils/login-flow.js).
--
-- Create the logins from Users (SuperUser at any location; the location is
-- just their home, the leads page does not depend on it).
--
-- Safe to re-run: every INSERT is guarded with NOT EXISTS.
-- ============================================================

-- 1. The role itself — same level as Helper (lowest staff tier)
INSERT INTO m_roles (role_name, role_display_name, role_description, role_level, is_active, is_customer_role, effective_start_date, effective_end_date)
SELECT 'TeleCaller', 'Tele Caller',
       'Telecalling staff: follows up dealer leads (Dealer Leads page only).',
       30, 1, 0, CURDATE(), '9999-12-31'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_roles WHERE role_name = 'TeleCaller');

-- 2. Permission — can_reset_role_id is NOT NULL with no default, set to role_id.
-- NOT "INSERT IGNORE": the unique index does not dedupe a NULL location_code.
INSERT INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code, created_by)
SELECT r.role_id, r.role_id, 'MANAGE_DEALER_LEADS', 0, CURDATE(), '9999-12-31', NULL, 'system'
FROM m_roles r
WHERE r.role_name = 'TeleCaller'
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions rp
      WHERE rp.role_id = r.role_id
        AND rp.permission_type = 'MANAGE_DEALER_LEADS'
        AND rp.location_code IS NULL
  );

-- 3. SuperUser can reset a TeleCaller's password
INSERT INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code, created_by)
SELECT su.role_id, tc.role_id, 'PASSWORD_RESET', 0, CURDATE(), '9999-12-31', NULL, 'system'
FROM m_roles su
JOIN m_roles tc ON tc.role_name = 'TeleCaller'
WHERE su.role_name = 'SuperUser'
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions rp
      WHERE rp.role_id = su.role_id
        AND rp.permission_type = 'PASSWORD_RESET'
        AND rp.can_reset_role_id = tc.role_id
  );

-- 4. Menu — DEALER_LEADS for TeleCaller
INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT 'TeleCaller', 'DEALER_LEADS', 1, CURDATE(), '9999-12-31', 'system'
FROM DUAL
WHERE EXISTS (SELECT 1 FROM m_menu_items WHERE menu_code = 'DEALER_LEADS')
  AND NOT EXISTS (
      SELECT 1 FROM m_menu_access_global g
      WHERE g.role = 'TeleCaller' AND g.menu_code = 'DEALER_LEADS'
  );

-- 5. Menu rows with role '*' apply to every role unless the role has its own
-- row — switch all of them off for TeleCaller (same as Cashier has).
INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT DISTINCT 'TeleCaller', w.menu_code, 0, CURDATE(), '9999-12-31', 'system'
FROM m_menu_access_global w
WHERE w.role = '*'
  AND w.menu_code <> 'DEALER_LEADS'
  AND NOT EXISTS (
      SELECT 1 FROM m_menu_access_global g
      WHERE g.role = 'TeleCaller' AND g.menu_code = w.menu_code
  );

CALL RefreshMenuCache();

-- ── Verify ────────────────────────────────────────────────────────────
SELECT role_id, role_name, role_level FROM m_roles WHERE role_name = 'TeleCaller';

SELECT r.role_name, rp.permission_type, rp.can_reset_role_id
FROM m_role_permissions rp JOIN m_roles r ON r.role_id = rp.role_id
WHERE r.role_name = 'TeleCaller'
   OR (rp.permission_type = 'PASSWORD_RESET' AND rp.can_reset_role_id = (SELECT role_id FROM m_roles WHERE role_name = 'TeleCaller'));

-- should list DEALER_LEADS only, for every location
SELECT menu_code, COUNT(*) AS locations FROM user_menu_cache WHERE role = 'TeleCaller' GROUP BY menu_code;
