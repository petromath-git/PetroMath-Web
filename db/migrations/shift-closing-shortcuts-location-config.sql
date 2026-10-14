-- ============================================================
-- SHIFT_CLOSING_SHORTCUTS — per-location switch for the Shift Closing
-- keyboard shortcuts (views/mixins/closing-shortcuts.pug).
-- 'Y' (default) = shortcuts available; each user can still turn them off
-- for themselves in the shortcut list. 'N' = not loaded at all for that
-- location (no link, no underlines, no keys).
--
-- Turn off for one location by adding a row for it, e.g.:
--   INSERT INTO m_location_config (location_code, setting_name, setting_value,
--       effective_start_date, effective_end_date, created_by, updated_by,
--       creation_date, updation_date)
--   VALUES ('<LOCATION_CODE>', 'SHIFT_CLOSING_SHORTCUTS', 'N', CURDATE(),
--       '9999-12-31', 'system', 'system', NOW(), NOW());
-- Safe to re-run.
-- ============================================================

INSERT INTO m_location_config_catalog
    (setting_name, short_description, detailed_description, value_type, lookup_type, created_by, updated_by)
VALUES
    ('SHIFT_CLOSING_SHORTCUTS',
     'Keyboard shortcuts on the Shift Closing screen',
     'Y = keyboard shortcuts on the Shift Closing screen (Alt + underlined letter for tabs, Alt+N Next, Alt+A Add, Enter moves to the next box, Esc back to the shift list). Each user can still turn them off for themselves. N = not shown to anyone at this location.',
     'LOOKUP', 'YN_FLAG', 'system', 'system')
ON DUPLICATE KEY UPDATE
    short_description = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    value_type = VALUES(value_type),
    lookup_type = VALUES(lookup_type),
    updated_by = 'system';

-- Global default (on). m_location_config has no unique key on
-- (location_code, setting_name), so guard against a duplicate row.
INSERT INTO m_location_config
    (location_code, setting_name, setting_value, effective_start_date, effective_end_date,
     created_by, updated_by, creation_date, updation_date)
SELECT '*', 'SHIFT_CLOSING_SHORTCUTS', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM m_location_config WHERE location_code = '*' AND setting_name = 'SHIFT_CLOSING_SHORTCUTS'
);
