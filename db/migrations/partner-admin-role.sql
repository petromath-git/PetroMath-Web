-- ============================================================
-- PartnerAdmin role migration
--
-- Creates a role that sits between Admin and SuperUser: near-SuperUser
-- permission set, but scoped at the application layer to a person's
-- assigned locations (m_person_location) instead of every location.
-- Explicitly excluded: MANAGE_PLATFORM_BILLING, ASSIGN_USER_LOCATIONS,
-- VIEW_USAGE_DASHBOARD, EXPORT_USAGE_DATA, and creating a brand-new
-- location directly (new CREATE_LOCATION_MASTER permission, SuperUser only —
-- see routes/location-master-routes.js for the corresponding code change).
--
-- Run once on each environment (dev / staging / prod).
-- Safe to re-run: every INSERT is guarded with NOT EXISTS.
-- ============================================================

-- 1. The role itself ---------------------------------------------------
INSERT INTO m_roles (role_name, role_display_name, role_description, role_level, is_active, is_customer_role, effective_start_date, effective_end_date)
SELECT
    'PartnerAdmin',
    'Partner Admin',
    'Manages a set of assigned locations end-to-end (menu configuration, location configuration, onboarding migration) with near-SuperUser access, excluding platform-level actions.',
    al.role_level + GREATEST(1, FLOOR((sl.role_level - al.role_level) / 2)),
    1, 0, CURDATE(), '9999-12-31'
FROM
    (SELECT role_level FROM m_roles WHERE role_name = 'Admin' LIMIT 1) al,
    (SELECT role_level FROM m_roles WHERE role_name = 'SuperUser' LIMIT 1) sl
WHERE NOT EXISTS (SELECT 1 FROM m_roles WHERE role_name = 'PartnerAdmin');

-- 2. Copy SuperUser's current permission grants to PartnerAdmin --------
-- Excludes platform-only capabilities. can_reset_role_id is set to the
-- new role's own role_id per the existing NOT-NULL-no-default convention
-- (see reference_role_permissions_gotcha memory) — INSERT IGNORE would
-- have silently dropped these rows without it.
-- The NOT EXISTS guard uses <=> (NULL-safe equals) on location_code
-- because a plain unique index does not dedupe NULL location_code rows.
INSERT INTO m_role_permissions (role_id, can_reset_role_id, permission_type, location_specific, location_code, effective_start_date, effective_end_date, created_by)
SELECT
    pa.role_id,
    pa.role_id,
    src.permission_type,
    src.location_specific,
    src.location_code,
    CURDATE(),
    '9999-12-31',
    'partner-admin-role-migration'
FROM m_role_permissions src
JOIN m_roles su ON su.role_id = src.role_id AND su.role_name = 'SuperUser'
JOIN m_roles pa ON pa.role_name = 'PartnerAdmin'
WHERE CURDATE() BETWEEN src.effective_start_date AND src.effective_end_date
  -- CREATE_LOCATION_MASTER must stay excluded even on a re-run: once step 4 (below)
  -- grants it to SuperUser, a second run of this script would otherwise see it as
  -- just another current SuperUser permission and copy it here too.
  AND src.permission_type NOT IN ('MANAGE_PLATFORM_BILLING', 'ASSIGN_USER_LOCATIONS', 'VIEW_USAGE_DASHBOARD', 'EXPORT_USAGE_DATA', 'CREATE_LOCATION_MASTER')
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions existing
      WHERE existing.role_id = pa.role_id
        AND existing.permission_type = src.permission_type
        AND existing.location_code <=> src.location_code
  );

-- 3. New permission: migrating an onboarding record into a live location.
-- Granted to SuperUser and PartnerAdmin only (not Admin — this is a new,
-- previously-ungated action; Admin gains nothing it didn't already lack).
INSERT INTO m_role_permissions (role_id, can_reset_role_id, permission_type, location_specific, location_code, effective_start_date, effective_end_date, created_by)
SELECT r.role_id, r.role_id, 'ONBOARDING_MIGRATE', 0, NULL, CURDATE(), '9999-12-31', 'partner-admin-role-migration'
FROM m_roles r
WHERE r.role_name IN ('SuperUser', 'PartnerAdmin')
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions existing
      WHERE existing.role_id = r.role_id
        AND existing.permission_type = 'ONBOARDING_MIGRATE'
        AND existing.location_code IS NULL
  );

-- 4. New permission: creating a brand-new location directly via location
-- master. SuperUser only. PartnerAdmin keeps MANAGE_LOCATION_MASTER
-- (inherited via step 2, for list/edit/deactivate of ITS assigned
-- locations) but must not be able to create one outright — new locations
-- still go through onboarding + ONBOARDING_MIGRATE.
-- NOTE: seeding this permission alone does not yet block creation — the
-- corresponding route change (splitting the create route in
-- routes/location-master-routes.js onto this permission) is a separate step.
INSERT INTO m_role_permissions (role_id, can_reset_role_id, permission_type, location_specific, location_code, effective_start_date, effective_end_date, created_by)
SELECT r.role_id, r.role_id, 'CREATE_LOCATION_MASTER', 0, NULL, CURDATE(), '9999-12-31', 'partner-admin-role-migration'
FROM m_roles r
WHERE r.role_name = 'SuperUser'
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions existing
      WHERE existing.role_id = r.role_id
        AND existing.permission_type = 'CREATE_LOCATION_MASTER'
        AND existing.location_code IS NULL
  );

-- 5. Refresh the menu cache so PartnerAdmin's nav (Menu Management,
-- Location Config, Onboarding) actually appears — user_menu_cache is a
-- materialized table, not read live from m_role_permissions.
CALL RefreshMenuCache();

-- ============================================================
-- Verification (run manually after the above — do not trust silent
-- INSERT success alone, per reference_role_permissions_gotcha):
-- ============================================================
-- SELECT * FROM m_roles WHERE role_name = 'PartnerAdmin';
--
-- SELECT rp.permission_type, rp.location_code, rp.can_reset_role_id
-- FROM m_role_permissions rp
-- JOIN m_roles r ON r.role_id = rp.role_id
-- WHERE r.role_name = 'PartnerAdmin'
-- ORDER BY rp.permission_type;
--
-- -- Confirm the exclusion list really is absent:
-- SELECT rp.permission_type FROM m_role_permissions rp
-- JOIN m_roles r ON r.role_id = rp.role_id
-- WHERE r.role_name = 'PartnerAdmin'
--   AND rp.permission_type IN ('MANAGE_PLATFORM_BILLING','ASSIGN_USER_LOCATIONS','VIEW_USAGE_DASHBOARD','EXPORT_USAGE_DATA');
-- -- should return zero rows
