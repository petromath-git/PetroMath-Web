-- Config gate for OCR auto-fill on the DSM bill-photo feature, separate from
-- ALLOW_DSM_BILL_PHOTO (photo capture) — a location can capture photos without
-- OCR (e.g. handwritten bills, or before the extraction regex has been tuned
-- against a sample of that location's bill format). Server-side (getPage)
-- ANDs this with allowBillPhoto, so this row is a no-op unless photo capture
-- is also enabled.

INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, created_by, updated_by)
VALUES
('ALLOW_DSM_BILL_OCR', 'Enable OCR auto-fill for DSM bill photos',
 'Y/N. When Y (and ALLOW_DSM_BILL_PHOTO is also Y), the DSM entry screen runs Tesseract OCR on a captured bill photo and auto-fills Bill No / Amount into empty fields, plus flags an unreadable photo for retake. Default N. Requires the extraction regex to have been checked against a sample bill from this location first — Tesseract reads printed text only, not handwriting. Checked in dsm-entry-controller.js.',
 'system', 'system')
ON DUPLICATE KEY UPDATE
    short_description    = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    updated_by            = 'system';

-- SFS: enabled to continue beta testing (2026-08-21). Regex NOT yet tuned
-- against a confirmed SFS bill sample — revisit once one is reviewed.
INSERT IGNORE INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
VALUES ('SFS', 'ALLOW_DSM_BILL_OCR', 'Y', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW());
