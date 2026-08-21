-- Config gate for the DSM credit-entry bill-photo capture feature.
-- Default is disabled (matches ALLOW_QUICK_ADD_VEHICLE convention — no
-- global '*' row, code falls back to 'N' when no row exists). Enable
-- per-location by inserting a 'Y' row.

INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, created_by, updated_by)
VALUES
('ALLOW_DSM_BILL_PHOTO', 'Enable bill photo capture on DSM entry screen',
 'Y/N. When Y, the DSM credit-entry screen (/dsm-entry) shows Upload/Take Photo controls to attach a photo of the printed thermal bill to each credit entry, plus a camera icon on saved entries to view/swap/remove it. Default N (disabled). Checked in dsm-entry-controller.js.',
 'system', 'system')
ON DUPLICATE KEY UPDATE
    short_description    = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    updated_by            = 'system';

-- SFS is the pilot location for this feature (active beta testing 2026-08-21).
INSERT IGNORE INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
VALUES ('SFS', 'ALLOW_DSM_BILL_PHOTO', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW());
