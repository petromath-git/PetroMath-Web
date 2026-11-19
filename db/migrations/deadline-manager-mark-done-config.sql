-- ============================================================
-- DEADLINE_MANAGER_CAN_MARK_DONE: may Managers record a deadline as
-- done ("Mark done" on the home page, Renewed / Reopen on /deadline)?
--
-- Admin, PowerUser and SuperUser can always. Default N = Admin and above
-- only. Set Y for a location where the Manager handles these.
--
-- Catalog row + a global '*' = N row (the Location Config screen only
-- lists settings that have at least one m_location_config row). Safe to re-run.
-- ============================================================

INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, value_type, lookup_type, created_by, updated_by)
VALUES
('DEADLINE_MANAGER_CAN_MARK_DONE', 'Allow Managers to mark deadlines as done',
 'Y/N. When Y, Managers can record a deadline as done: the "Mark done" button on the home page deadline card, and Renewed / Reopen on Deadlines & Renewals. Admin, PowerUser and SuperUser can always. Default N. Checked in deadline-controller.js.',
 'LOOKUP', 'YN_FLAG', 'system', 'system')
ON DUPLICATE KEY UPDATE
    short_description    = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    value_type           = VALUES(value_type),
    lookup_type          = VALUES(lookup_type),
    updated_by           = 'system';

-- Global default N (guarded: m_location_config has no unique key)
INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
SELECT '*', 'DEADLINE_MANAGER_CAN_MARK_DONE', 'N', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_location_config WHERE setting_name = 'DEADLINE_MANAGER_CAN_MARK_DONE');

-- Allow Managers at a location (replace <LOC>):
-- INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
-- VALUES ('<LOC>', 'DEADLINE_MANAGER_CAN_MARK_DONE', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW());
