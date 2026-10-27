-- ============================================================
-- ALLOW_DAY_CLOSE_REOPEN: let Admins reopen a CLOSED Day Close
-- (cashflow) at their own location.
--
-- SuperUser / PowerUser / GOBI-INC can always reopen; this flag
-- only adds the Admin role. The usual rule still applies: only
-- the latest CLOSED day can be reopened.
--
-- Catalog row only -- default is N. Turn it on per location from
-- Location Config, or with the INSERT below. Safe to re-run.
-- ============================================================

INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, value_type, lookup_type, created_by, updated_by)
VALUES
('ALLOW_DAY_CLOSE_REOPEN', 'Allow Admins to reopen a closed Day Close',
 'Y/N. When Y, users with the Admin role can reopen a CLOSED Day Close (cashflow) at this location back to DRAFT. SuperUser, PowerUser and GOBI-INC can always reopen regardless of this flag. Only the latest closed day can be reopened. Default N. Checked in cash-flow-controller.js.',
 'LOOKUP', 'YN_FLAG', 'system', 'system')
ON DUPLICATE KEY UPDATE
    short_description    = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    value_type           = VALUES(value_type),
    lookup_type          = VALUES(lookup_type),
    updated_by           = 'system';

-- Enable for a location (replace <LOC>):
-- INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by)
-- VALUES ('<LOC>', 'ALLOW_DAY_CLOSE_REOPEN', 'Y', CURDATE(), '9999-12-31', 'system', 'system');
