-- Config gate for automatic bill-edge detection/crop on the DSM bill-photo
-- feature, separate from ALLOW_DSM_BILL_PHOTO and ALLOW_DSM_BILL_OCR. Loads
-- OpenCV.js + jscanify (client-side, ~8-10MB) to auto-detect and crop/deskew
-- the bill like Adobe Scan. Kept as its own gate since it's the least proven
-- of the three (needs real low-end-Android testing) and may need to be
-- switched off quickly per-location without touching photo capture or OCR.

INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, created_by, updated_by)
VALUES
('ALLOW_DSM_BILL_AUTOCROP', 'Enable automatic bill-edge crop on DSM bill photos',
 'Y/N. When Y (and ALLOW_DSM_BILL_PHOTO is also Y), the DSM entry screen loads OpenCV.js + jscanify to auto-detect the bill''s edges and crop/straighten the photo before compression, like Adobe Scan. Falls back to the full uncropped photo whenever detection fails or looks unconfident -- never blocks saving. Default N. Adds a heavy (~8-10MB) client-side library load, gated separately so it can be disabled per-location without affecting photo capture or OCR. Checked in dsm-entry-controller.js.',
 'system', 'system')
ON DUPLICATE KEY UPDATE
    short_description    = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    updated_by            = 'system';

-- SFS: enabled to trial on real beta devices (2026-08-21). Unproven on
-- low-end Android -- watch for load-time/performance complaints.
INSERT IGNORE INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
VALUES ('SFS', 'ALLOW_DSM_BILL_AUTOCROP', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW());
