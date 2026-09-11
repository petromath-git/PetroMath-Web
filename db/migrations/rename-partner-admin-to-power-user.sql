-- ============================================================
-- Rename PartnerAdmin -> PowerUser
--
-- "Partner" already has a specific meaning in this business (financial
-- partner/stakeholder), so the role introduced by partner-admin-role.sql
-- and partner-admin-menu-access.sql is renamed. m_role_permissions links
-- by role_id (numeric FK), so renaming m_roles.role_name is sufficient
-- there. Every other table stores the role as a plain string and needs
-- an explicit UPDATE. Only relevant on an environment that already ran
-- the old-named migrations (e.g. beta) — on a fresh environment (e.g.
-- prod, once those two files are updated to say PowerUser directly),
-- these UPDATEs simply match zero rows.
--
-- Run once. Safe to re-run (each UPDATE is a no-op once applied).
-- ============================================================

UPDATE m_roles
SET role_name = 'PowerUser',
    role_display_name = 'Power User',
    role_description = 'Manages a set of assigned locations end-to-end (menu configuration, location configuration, onboarding migration) with near-SuperUser access, excluding platform-level actions.'
WHERE role_name = 'PartnerAdmin';

UPDATE m_menu_access_global SET role = 'PowerUser' WHERE role = 'PartnerAdmin';
UPDATE m_menu_access_override SET role = 'PowerUser' WHERE role = 'PartnerAdmin';
UPDATE m_persons SET Role = 'PowerUser' WHERE Role = 'PartnerAdmin';
UPDATE m_person_location SET role = 'PowerUser' WHERE role = 'PartnerAdmin';

CALL RefreshMenuCache();
